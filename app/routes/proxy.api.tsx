import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { getFile, GoogleNotConnected, startResumableUpload } from "../lib/google.server";
import {
  eligibleOrders,
  fileProblem,
  LIMITS,
  logSubmission,
  portalAllowed,
  rewardSettings,
  submissionBlocker,
  submissionFolder,
} from "../lib/rewards.server";
import { portalContext, storefrontHosts } from "../lib/portal.server";

// POST /apps/rewards/api — JSON actions for the upload page. Every action is scoped to the
// signed-in customer (from Shopify's signed proxy request), never to IDs the browser sends.
const fail = (message: string, status = 400) => Response.json({ ok: false, message }, { status });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, customerId } = await portalContext(request);
  if (!customerId) return fail("Please sign in again.", 401);
  if (!admin) return fail("Rewards aren't available right now.", 503);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");

  // Loads a submission only if it belongs to this customer and is still editable.
  const ownSubmission = async () => {
    const s = await db.submission.findFirst({
      where: { id: str("submissionId"), shop, customerId },
      include: { rewardType: true, files: { where: { status: { in: ["UPLOADING", "UPLOADED"] } } } },
    });
    if (!s || !["DRAFT", "NEEDS_CHANGES"].includes(s.status)) return null;
    return s;
  };

  try {
    switch (str("action")) {
      case "start": {
        const orderId = `gid://shopify/Order/${str("orderId").replace(/\D/g, "")}`;
        const settings = await rewardSettings(shop);
        const [data, type] = await Promise.all([
          eligibleOrders(admin, customerId, settings.eligibleDays),
          db.rewardType.findFirst({ where: { id: str("typeId"), shop } }),
        ]);
        if (!portalAllowed(settings, data?.email)) return fail("Rewards are coming soon.", 403);
        const order = data?.orders.find((o) => o.id === orderId);
        if (!order || !type) return fail("This order isn't eligible for rewards.");

        const existing = await db.submission.findFirst({
          where: { shop, customerId, orderId, rewardTypeId: type.id, status: { in: ["DRAFT", "NEEDS_CHANGES"] } },
          include: { files: { where: { status: "UPLOADED" } } },
          orderBy: { createdAt: "desc" },
        });
        if (existing) {
          return Response.json({
            ok: true,
            submissionId: existing.id,
            files: existing.files.map((f) => ({ id: f.id, name: f.name, size: Number(f.size) })),
          });
        }
        const blocked = await submissionBlocker(shop, orderId, type);
        if (blocked) return fail(blocked);
        const s = await db.submission.create({
          data: {
            shop,
            customerId,
            customerName: data?.name,
            customerEmail: data?.email,
            orderId,
            orderName: order.name,
            rewardTypeId: type.id,
          },
        });
        await logSubmission(s.id, "created");
        return Response.json({ ok: true, submissionId: s.id, files: [] });
      }

      case "upload-url": {
        const s = await ownSubmission();
        if (!s) return fail("This submission can't be changed.");
        const name = str("name").slice(0, 200) || "upload";
        const size = Number(body.size);
        const mimeType = str("mimeType") || guessType(name);
        if (!(size > 0)) return fail("That file is empty.");
        const problem = fileProblem(mimeType, size, s.rewardType.media);
        if (problem) return fail(problem);

        const isVideo = mimeType.startsWith("video/");
        const sameKind = s.files.filter((f) => f.mimeType.startsWith(isVideo ? "video/" : "image/")).length;
        const max = isVideo ? LIMITS.videosPerSubmission : LIMITS.photosPerSubmission;
        if (sameKind >= max) return fail(`You can add up to ${max} ${isVideo ? "videos" : "photos"}.`);

        const origin = str("origin");
        const hosts = await storefrontHosts(admin, shop);
        if (!/^https:\/\//.test(origin) || !hosts.includes(new URL(origin).host)) {
          return fail("Uploads have to come from the store's website.");
        }

        const folder = await submissionFolder(s);
        const uploadUrl = await startResumableUpload(shop, { name, mimeType, size, parentId: folder, origin });
        const file = await db.submissionFile.create({
          data: { submissionId: s.id, name, mimeType, size: BigInt(size) },
        });
        return Response.json({ ok: true, fileId: file.id, uploadUrl });
      }

      case "upload-done": {
        const s = await ownSubmission();
        if (!s) return fail("This submission can't be changed.");
        const file = s.files.find((f) => f.id === str("fileId"));
        if (!file) return fail("Unknown file.");
        // Trust Drive, not the browser: the file must exist inside this submission's folder.
        const driveFile = await getFile(shop, str("driveFileId"));
        if (driveFile.trashed || !driveFile.parents?.includes(s.driveFolderId ?? "")) {
          return fail("We couldn't find that upload — please try again.");
        }
        await db.submissionFile.update({
          where: { id: file.id },
          data: { status: "UPLOADED", driveFileId: driveFile.id, uploadedAt: new Date() },
        });
        await logSubmission(s.id, "file_uploaded", file.name);
        return Response.json({ ok: true });
      }

      case "remove-file": {
        const s = await ownSubmission();
        if (!s) return fail("This submission can't be changed.");
        const removed = await db.submissionFile.updateMany({
          where: { id: str("fileId"), submissionId: s.id },
          data: { status: "REMOVED" },
        });
        return removed.count ? Response.json({ ok: true }) : fail("Unknown file.");
      }

      case "submit": {
        const s = await ownSubmission();
        if (!s) return fail("This submission can't be changed.");
        if (body.agreed !== true) return fail("Please agree to the content terms.");
        if (!s.files.some((f) => f.status === "UPLOADED")) return fail("Add at least one file first.");
        const settings = await rewardSettings(shop);
        await db.submission.update({
          where: { id: s.id },
          data: {
            status: "PENDING",
            note: str("note").slice(0, 2000) || null,
            agreementVersion: settings.agreementVersion,
            agreedAt: new Date(),
            submittedAt: new Date(),
            reviewMessage: null,
          },
        });
        await logSubmission(s.id, s.status === "NEEDS_CHANGES" ? "resubmitted" : "submitted");
        return Response.json({ ok: true });
      }

      default:
        return fail("Unknown action.");
    }
  } catch (e) {
    console.error("[proxy/api]", e);
    if (e instanceof GoogleNotConnected) return fail("Uploads are paused for a moment — please try again later.", 503);
    return fail("Something went wrong — please try again.", 500);
  }
};

function guessType(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      mov: "video/quicktime",
      mp4: "video/mp4",
      m4v: "video/x-m4v",
      heic: "image/heic",
      heif: "image/heif",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}
