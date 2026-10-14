import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { ResourceKind, ResourceSection } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const SECTION_LABEL: Record<ResourceSection, string> = {
  HERO: "Hero: “Download guide” button",
  BEFORE: "Before you build",
  BUILD: "Assembly guides",
  AFTER: "After your build: warranty & care",
};
const SECTIONS = Object.keys(SECTION_LABEL) as ResourceSection[];
const KIND_LABEL: Record<ResourceKind, string> = {
  PDF: "PDF",
  VIDEO: "Video",
  CHECKLIST: "Checklist",
  GUIDE: "Guide",
  LINK: "Link",
  APP_3D: "3D instructional app",
};
const KINDS = Object.keys(KIND_LABEL) as ResourceKind[];

const PRODUCT = `#graphql
  query BuildResourceProduct($id: ID!) {
    product(id: $id) {
      id
      title
      variants(first: 250) { nodes { id title } }
    }
  }`;

// /app/build-resources?product=<gid>&variant=<gid> — files and kit specs customers see on the hub's
// Build Resources page. No variant = resources for every size of the product.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const params = new URL(request.url).searchParams;
  const productId = params.get("product");
  const variantId = params.get("variant") || null;

  const [resourceProducts, specProducts] = await Promise.all([
    db.buildResource.findMany({ where: { shop }, distinct: ["productId"], select: { productId: true, productTitle: true } }),
    db.kitSpec.findMany({ where: { shop }, distinct: ["productId"], select: { productId: true, productTitle: true } }),
  ]);
  const configured = [...new Map([...specProducts, ...resourceProducts].map((p) => [p.productId, p])).values()];

  if (!productId) return { configured, product: null, variantId: null, resources: [], spec: null };

  const res = await admin.graphql(PRODUCT, { variables: { id: productId } });
  const json = (await res.json()) as {
    data?: { product: { id: string; title: string; variants: { nodes: { id: string; title: string }[] } } | null };
  };
  const p = json.data?.product;
  if (!p) return { configured, product: null, variantId: null, resources: [], spec: null };

  const [resources, spec] = await Promise.all([
    db.buildResource.findMany({ where: { shop, productId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.kitSpec.findFirst({ where: { shop, productId, variantId } }),
  ]);
  return {
    configured,
    product: { id: p.id, title: p.title, variants: p.variants.nodes },
    variantId,
    resources: resources.map((r) => ({
      id: r.id,
      variantId: r.variantId,
      section: r.section,
      kind: r.kind,
      title: r.title,
      description: r.description ?? "",
      url: r.url,
      meta: r.meta ?? "",
    })),
    spec: spec && { specLabel: spec.specLabel ?? "", buildTime: spec.buildTime ?? "", deckSize: spec.deckSize ?? "" },
  };
};

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  const id = text(form, "id");
  const scope = {
    productId: text(form, "productId"),
    productTitle: text(form, "productTitle") || null,
    variantId: text(form, "variantId") || null,
    variantTitle: text(form, "variantTitle") || null,
  };

  if (intent === "spec") {
    if (!scope.productId) return { ok: false, message: "Pick a product" };
    const data = {
      ...scope,
      specLabel: text(form, "specLabel") || null,
      buildTime: text(form, "buildTime") || null,
      deckSize: text(form, "deckSize") || null,
    };
    const existing = await db.kitSpec.findFirst({ where: { shop, productId: scope.productId, variantId: scope.variantId } });
    if (existing) await db.kitSpec.update({ where: { id: existing.id }, data });
    else await db.kitSpec.create({ data: { ...data, shop } });
    return { ok: true, message: "Kit spec saved" };
  }

  if (intent === "save") {
    const section = text(form, "section") as ResourceSection;
    const kind = text(form, "kind") as ResourceKind;
    const title = text(form, "title");
    const url = text(form, "url");
    if (!title || !url) return { ok: false, message: "Title and URL are required" };
    if (!/^https:\/\//i.test(url)) return { ok: false, message: "The URL must start with https://" };
    if (!SECTIONS.includes(section) || !KINDS.includes(kind)) return { ok: false, message: "Check the section and type" };
    const data = { section, kind, title, url, description: text(form, "description") || null, meta: text(form, "meta") || null };
    if (id) {
      const updated = await db.buildResource.updateMany({ where: { id, shop }, data });
      if (!updated.count) return { ok: false, message: "Not found" };
    } else {
      if (!scope.productId) return { ok: false, message: "Pick a product" };
      const last = await db.buildResource.findFirst({
        where: { shop, productId: scope.productId, variantId: scope.variantId, section },
        orderBy: { position: "desc" },
      });
      await db.buildResource.create({ data: { ...data, ...scope, shop, position: (last?.position ?? -1) + 1 } });
    }
    return { ok: true, message: `"${title}" saved`, saved: true };
  }

  if (intent === "delete") {
    const deleted = await db.buildResource.deleteMany({ where: { id, shop } });
    return { ok: !!deleted.count, message: deleted.count ? "Resource deleted" : "Not found" };
  }

  if (intent === "move") {
    const row = await db.buildResource.findFirst({ where: { id, shop } });
    if (!row) return { ok: false, message: "Not found" };
    const siblings = await db.buildResource.findMany({
      where: { shop, productId: row.productId, variantId: row.variantId, section: row.section },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    const from = siblings.findIndex((s) => s.id === id);
    const to = from + (form.get("dir") === "up" ? -1 : 1);
    if (to < 0 || to >= siblings.length) return { ok: true, message: "Already there" };
    [siblings[from], siblings[to]] = [siblings[to], siblings[from]];
    await db.$transaction(siblings.map((s, i) => db.buildResource.update({ where: { id: s.id }, data: { position: i } })));
    return { ok: true, message: "Moved" };
  }
  return { ok: false, message: "Unknown action" };
};

type Data = Awaited<ReturnType<typeof loader>>;
type Row = Data["resources"][number];

export default function BuildResources() {
  const { configured, product, variantId, resources, spec } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null); // resource id, "new:<SECTION>" or null

  useEffect(() => {
    const data = fetcher.data as { ok: boolean; message: string; saved?: boolean } | undefined;
    if (!data) return;
    shopify.toast.show(data.message, { isError: !data.ok });
    if (data.saved) setEditing(null);
  }, [fetcher.data, shopify]);

  const go = (productId: string, variant?: string | null) => {
    setEditing(null);
    navigate(`/app/build-resources?product=${encodeURIComponent(productId)}${variant ? `&variant=${encodeURIComponent(variant)}` : ""}`);
  };
  const pickProduct = async () => {
    const picked = await shopify.resourcePicker({ type: "product", multiple: false, filter: { variants: false } });
    const p = picked?.[0];
    if (p) go(p.id);
  };

  const variant = product?.variants.find((v) => v.id === variantId) ?? null;
  const scope = {
    productId: product?.id ?? "",
    productTitle: product?.title ?? "",
    variantId: variant?.id ?? "",
    variantTitle: variant?.title ?? "",
  };
  const inScope = resources.filter((r) => (r.variantId ?? null) === (variant?.id ?? null));
  const countFor = (vid: string | null) => resources.filter((r) => (r.variantId ?? null) === vid).length;

  return (
    <s-page heading="Build resources">
      <s-button slot="primary-action" onClick={pickProduct}>
        {product ? "Choose another product" : "Choose a deck kit"}
      </s-button>

      <s-section heading="Deck kit">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Customers see these files on Build Resources in the hub for each deck kit they ordered. Add
            resources for every size, then override or add to them for one size: a size&apos;s resource with
            the same section and title replaces the every-size one.
          </s-paragraph>
          {product ? (
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-text type="strong">{product.title}</s-text>
              {product.variants.length > 1 && (
                <s-select
                  label="Size"
                  value={variant?.id ?? ""}
                  onChange={(e) => go(product.id, e.currentTarget.value || null)}
                >
                  <s-option value="">All sizes ({countFor(null)})</s-option>
                  {product.variants.map((v) => (
                    <s-option key={v.id} value={v.id}>
                      {v.title} ({countFor(v.id)})
                    </s-option>
                  ))}
                </s-select>
              )}
            </s-stack>
          ) : (
            <s-button variant="primary" onClick={pickProduct}>
              Choose a deck kit
            </s-button>
          )}
          {configured.length > 0 && (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">Set up:</s-text>
              {configured.map((p) => (
                <s-button key={p.productId} variant="tertiary" onClick={() => go(p.productId)}>
                  {p.productTitle ?? p.productId}
                </s-button>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {product && (
        <>
          <s-section heading={`Kit spec${variant ? ` · ${variant.title}` : " · all sizes"}`}>
            <fetcher.Form method="post" key={`spec-${variant?.id ?? "all"}`}>
              <input type="hidden" name="intent" value="spec" />
              <ScopeInputs scope={scope} />
              <s-stack gap="base">
                <s-stack direction="inline" gap="base">
                  <s-text-field name="specLabel" label="Kit spec" placeholder="10′ × 12′ Freestanding" defaultValue={spec?.specLabel ?? ""} />
                  <s-text-field name="buildTime" label="Estimated build" placeholder="1.5 - 2 Days (2 adults)" defaultValue={spec?.buildTime ?? ""} />
                  <s-text-field name="deckSize" label="Deck size" placeholder="120 sq ft" defaultValue={spec?.deckSize ?? ""} />
                </s-stack>
                {variant && !spec && (
                  <s-paragraph color="subdued">No spec for this size yet, so customers see the all-sizes spec.</s-paragraph>
                )}
                <s-button type="submit">Save kit spec</s-button>
              </s-stack>
            </fetcher.Form>
          </s-section>

          {SECTIONS.map((section) => {
            const rows = inScope.filter((r) => r.section === section);
            return (
              <s-section key={section} heading={SECTION_LABEL[section]}>
                <s-stack gap="base">
                  {rows.length === 0 && editing !== `new:${section}` && (
                    <s-paragraph color="subdued">
                      Nothing here{variant ? " for this size: customers see the all-sizes resources" : ""}.
                    </s-paragraph>
                  )}
                  {rows.map((r, i) =>
                    editing === r.id ? (
                      <ResourceForm key={r.id} fetcher={fetcher} scope={scope} row={r} section={section} onCancel={() => setEditing(null)} />
                    ) : (
                      <s-stack key={r.id} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                        <s-stack gap="small-100">
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <s-text type="strong">{r.title}</s-text>
                            <s-badge>{KIND_LABEL[r.kind]}</s-badge>
                            {r.meta && <s-text color="subdued">{r.meta}</s-text>}
                          </s-stack>
                          {r.description && <s-text color="subdued">{r.description}</s-text>}
                          <s-link href={r.url} target="_blank">
                            {r.url.length > 70 ? `${r.url.slice(0, 70)}…` : r.url}
                          </s-link>
                        </s-stack>
                        <s-stack direction="inline" gap="small-200">
                          <s-button variant="tertiary" icon="arrow-up" accessibilityLabel="Move up" disabled={i === 0}
                            onClick={() => fetcher.submit({ intent: "move", id: r.id, dir: "up" }, { method: "POST" })} />
                          <s-button variant="tertiary" icon="arrow-down" accessibilityLabel="Move down" disabled={i === rows.length - 1}
                            onClick={() => fetcher.submit({ intent: "move", id: r.id, dir: "down" }, { method: "POST" })} />
                          <s-button variant="tertiary" onClick={() => setEditing(r.id)}>Edit</s-button>
                          <s-button variant="tertiary" tone="critical"
                            onClick={() => {
                              if (confirm(`Delete "${r.title}"?`)) fetcher.submit({ intent: "delete", id: r.id }, { method: "POST" });
                            }}
                          >
                            Delete
                          </s-button>
                        </s-stack>
                      </s-stack>
                    ),
                  )}
                  {editing === `new:${section}` ? (
                    <ResourceForm fetcher={fetcher} scope={scope} section={section} onCancel={() => setEditing(null)} />
                  ) : (
                    <s-stack direction="inline">
                      <s-button onClick={() => setEditing(`new:${section}`)}>Add resource</s-button>
                    </s-stack>
                  )}
                </s-stack>
              </s-section>
            );
          })}
        </>
      )}
    </s-page>
  );
}

type Scope = { productId: string; productTitle: string; variantId: string; variantTitle: string };

function ScopeInputs({ scope }: { scope: Scope }) {
  return (
    <>
      {Object.entries(scope).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

const kindFor = (mime: string): ResourceKind | null =>
  mime === "application/pdf" ? "PDF" : mime.startsWith("video/") ? "VIDEO" : null;

function ResourceForm({
  fetcher,
  scope,
  row,
  section,
  onCancel,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  scope: Scope;
  row?: Row;
  section: ResourceSection;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(row?.url ?? "");
  const [kind, setKind] = useState<ResourceKind>(row?.kind ?? (section === "AFTER" || section === "HERO" ? "PDF" : "GUIDE"));
  const [upload, setUpload] = useState<{ busy: boolean; note: string } | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const mimeType = file.type || "application/octet-stream";
    const step = async (fields: Record<string, string>) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.append(k, v);
      const res = await fetch("/app/build-resources/upload", { method: "POST", body });
      const json = (await res.json()) as { error?: string; target?: StagedTarget; id?: string; url?: string | null };
      if (json.error) throw new Error(json.error);
      return json;
    };
    try {
      setUpload({ busy: true, note: `Uploading ${file.name}…` });
      const { target } = await step({ step: "stage", filename: file.name, mimeType, fileSize: String(file.size) });
      const post = new FormData();
      for (const p of target!.parameters) post.append(p.name, p.value);
      post.append("file", file);
      const sent = await fetch(target!.url, { method: "POST", body: post });
      if (!sent.ok) throw new Error(`Upload failed (${sent.status})`);
      setUpload({ busy: true, note: "Processing in Shopify Files…" });
      const { id } = await step({ step: "create", resourceUrl: target!.resourceUrl, filename: file.name, mimeType });
      // Videos can take a few minutes to process; check every 3 seconds for up to 10 minutes.
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { url: ready } = await step({ step: "status", id: id! });
        if (ready) {
          setUrl(ready);
          const k = kindFor(mimeType);
          if (k) setKind(k);
          setUpload({ busy: false, note: `Uploaded ${file.name}. Save to keep it.` });
          return;
        }
      }
      throw new Error("Shopify is still processing the file. Check Content › Files and paste its link.");
    } catch (e) {
      setUpload({ busy: false, note: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save" />
        {row ? <input type="hidden" name="id" value={row.id} /> : <ScopeInputs scope={scope} />}
        <input type="hidden" name="url" value={url} />
        <input type="hidden" name="kind" value={kind} />
        <s-stack gap="base">
          <s-stack direction="inline" gap="base">
            <s-select name="section" label="Section" value={row?.section ?? section}>
              {SECTIONS.map((s) => (
                <s-option key={s} value={s}>{SECTION_LABEL[s]}</s-option>
              ))}
            </s-select>
            <s-select label="Type" value={kind} onChange={(e) => setKind(e.currentTarget.value as ResourceKind)}>
              {KINDS.map((k) => (
                <s-option key={k} value={k}>{KIND_LABEL[k]}</s-option>
              ))}
            </s-select>
            <s-text-field name="meta" label="Detail (optional)" placeholder="24 pgs" defaultValue={row?.meta ?? ""} />
          </s-stack>
          <s-text-field name="title" label="Title" placeholder="Footing Plan" defaultValue={row?.title ?? ""} required />
          <s-text-field name="description" label="Description (optional)" defaultValue={row?.description ?? ""} />
          <s-text-field
            label="URL"
            placeholder="https://"
            value={url}
            onInput={(e) => setUrl(e.currentTarget.value)}
            details="A link to the file, video or app. Or upload a file below and we'll fill this in."
          />
          <s-drop-zone
            label="Upload to Shopify Files (PDF, video or image)"
            accept="application/pdf,video/*,image/*"
            disabled={upload?.busy}
            onChange={(e) => onFile(e.currentTarget.files?.[0])}
          />
          {upload && <s-text color={upload.busy ? "subdued" : undefined}>{upload.note}</s-text>}
          <s-stack direction="inline" gap="base">
            <s-button type="submit" variant="primary" disabled={upload?.busy}>Save</s-button>
            <s-button variant="tertiary" onClick={onCancel}>Cancel</s-button>
          </s-stack>
        </s-stack>
      </fetcher.Form>
    </s-box>
  );
}

type StagedTarget = { url: string; resourceUrl: string; parameters: { name: string; value: string }[] };

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
