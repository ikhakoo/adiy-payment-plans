// Build resources: loading them for a customer's order, and uploading files to Shopify Files for
// the admin editor (app.build-resources.tsx).
import type { BuildResource, KitSpec } from "@prisma/client";
import db from "../db.server";
import { resourcesForOrder, specForOrder, type OrderLine } from "./resources";

/** Resources (by section) and kit spec for an order's line items; `line` is the line the spec belongs to. */
export async function orderResources<L extends OrderLine>(shop: string, lines: L[]) {
  const productIds = [...new Set(lines.map((l) => l.productId).filter((id): id is string => !!id))];
  if (!productIds.length) return { sections: resourcesForOrder<BuildResource>([], []), spec: null, specLine: null as L | null };
  const [resources, specs] = await Promise.all([
    db.buildResource.findMany({ where: { shop, productId: { in: productIds } } }),
    db.kitSpec.findMany({ where: { shop, productId: { in: productIds } } }),
  ]);
  const found = specForOrder<KitSpec>(lines, specs);
  return {
    sections: resourcesForOrder(lines, resources),
    spec: found?.spec ?? null,
    specLine: (found?.line as L | undefined) ?? null,
  };
}

// ---------------------------------------------------------------- Shopify Files uploads

type Graphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

export type UploadKind = "FILE" | "VIDEO" | "IMAGE";

/** Shopify Files type for a browser file: videos and images get processed media, everything else a generic file. */
export const uploadKind = (mimeType: string): UploadKind =>
  mimeType.startsWith("video/") ? "VIDEO" : mimeType.startsWith("image/") ? "IMAGE" : "FILE";

const STAGE = `#graphql
  mutation StageResourceUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;

/** Step 1: a staged upload target the browser POSTs the file to. */
export async function stageUpload(graphql: Graphql, file: { filename: string; mimeType: string; fileSize: number }) {
  const res = await graphql(STAGE, {
    variables: {
      input: [
        {
          filename: file.filename,
          mimeType: file.mimeType,
          fileSize: String(file.fileSize),
          resource: uploadKind(file.mimeType),
          httpMethod: "POST",
        },
      ],
    },
  });
  const json = (await res.json()) as {
    data?: {
      stagedUploadsCreate: {
        stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[] | null;
        userErrors: { message: string }[];
      };
    };
  };
  const payload = json.data?.stagedUploadsCreate;
  const target = payload?.stagedTargets?.[0];
  if (!target) throw new Error(payload?.userErrors[0]?.message ?? "Couldn't start the upload");
  return target;
}

const CREATE = `#graphql
  mutation CreateResourceFile($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus }
      userErrors { field message }
    }
  }`;

/** Step 2: turn the uploaded file into a Shopify File. Processing is async; poll with fileUrl(). */
export async function createFile(graphql: Graphql, resourceUrl: string, filename: string, mimeType: string) {
  const res = await graphql(CREATE, {
    variables: {
      files: [
        {
          originalSource: resourceUrl,
          filename,
          contentType: uploadKind(mimeType),
          duplicateResolutionMode: "APPEND_UUID",
        },
      ],
    },
  });
  const json = (await res.json()) as {
    data?: { fileCreate: { files: { id: string }[] | null; userErrors: { message: string }[] } };
  };
  const id = json.data?.fileCreate.files?.[0]?.id;
  if (!id) throw new Error(json.data?.fileCreate.userErrors[0]?.message ?? "Couldn't save the file");
  return id;
}

const STATUS = `#graphql
  query ResourceFileStatus($id: ID!) {
    node(id: $id) {
      ... on GenericFile { fileStatus url fileErrors { message } }
      ... on MediaImage { fileStatus image { url } fileErrors { message } }
      ... on Video { fileStatus originalSource { url } sources { url mimeType } fileErrors { message } }
    }
  }`;

/** Step 3: the file's public URL once Shopify has finished processing it (null while it's still working). */
export async function fileUrl(graphql: Graphql, id: string) {
  const res = await graphql(STATUS, { variables: { id } });
  const json = (await res.json()) as {
    data?: {
      node: {
        fileStatus?: "FAILED" | "PROCESSING" | "READY" | "UPLOADED";
        url?: string | null;
        image?: { url: string } | null;
        originalSource?: { url: string } | null;
        sources?: { url: string; mimeType: string }[];
        fileErrors?: { message: string }[];
      } | null;
    };
  };
  const node = json.data?.node;
  if (!node?.fileStatus) throw new Error("File not found");
  if (node.fileStatus === "FAILED") throw new Error(node.fileErrors?.[0]?.message ?? "Shopify couldn't process the file");
  if (node.fileStatus !== "READY") return null;
  const mp4 = node.sources?.find((s) => s.mimeType === "video/mp4");
  return node.url ?? node.image?.url ?? mp4?.url ?? node.sources?.[0]?.url ?? node.originalSource?.url ?? null;
}
