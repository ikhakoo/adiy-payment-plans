import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createFile, fileUrl, stageUpload } from "../lib/resources.server";

// POST /app/build-resources/upload — JSON steps for uploading a build-resource file to Shopify Files:
// step=stage → staged target the browser posts the file to; step=create → file id; step=status → url once READY.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const step = form.get("step");
  const filename = String(form.get("filename") ?? "").slice(0, 200);
  const mimeType = String(form.get("mimeType") || "application/octet-stream");
  try {
    if (step === "stage") {
      const fileSize = Number(form.get("fileSize"));
      if (!filename || !(fileSize > 0)) return Response.json({ error: "Pick a file" }, { status: 400 });
      return Response.json({ target: await stageUpload(admin.graphql, { filename, mimeType, fileSize }) });
    }
    if (step === "create") {
      const resourceUrl = String(form.get("resourceUrl") ?? "");
      if (!resourceUrl.startsWith("https://")) return Response.json({ error: "Upload missing" }, { status: 400 });
      return Response.json({ id: await createFile(admin.graphql, resourceUrl, filename, mimeType) });
    }
    if (step === "status") {
      return Response.json({ url: await fileUrl(admin.graphql, String(form.get("id") ?? "")) });
    }
    return Response.json({ error: "Unknown step" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
};
