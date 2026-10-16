// HTML for an order's progress, shared by Track My Deck and the Overview.
import { esc } from "./portal.server";
import type { HubOrder } from "./orders.server";
import { carrierTrackingUrl, orderUpdates, PRODUCTION_CHECKLIST, type DeckProgress, type DeckStep, type UpdateKind } from "./tracking";

const ORDER: DeckStep[] = ["production", "packing", "shipped", "delivered"];

/** "#212481885" — some order names come without the "#", so always show one. */
export const orderNo = (name: string) => `#${name.trim().replace(/^#+/, "")}`;

// Dates on the tracker read in the store's time (US Eastern), like the business-day pacing in tracking.ts.
const TZ = "America/New_York";
/** "Oct 14" */
export const fmtShort = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "2-digit" });
/** "10:42 AM" */
const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
/** "Oct 14, 2026 · 10:42 AM" */
export const fmtStamp = (d: Date | string) =>
  `${new Date(d).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "2-digit", year: "numeric" })} · ${fmtTime(d)}`;

/** Filled glyph (the Figma uses Material Symbols) sized by CSS, coloured by currentColor. */
const glyph = (viewBox: string, d: string) =>
  `<svg viewBox="${viewBox}" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
/** Stroke icon on a 24 grid, for glyphs the Figma export didn't give us cleanly. */
const stroke = (paths: string, width = 2) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Icons from the Overview and Track My Deck frames. */
export const GLYPH = {
  check: glyph("0 0 15 11", "M5.2454 11L0 5.78586L1.31135 4.48233L5.2454 8.39293L13.6887 0L15 1.30353L5.2454 11Z"),
  checkCircle: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7 12.4 3.3 3.3L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  verified: glyph("0 0 22 21", "M7.6 21L5.7 17.8L2.1 17L2.45 13.3L0 10.5L2.45 7.7L2.1 4L5.7 3.2L7.6 0L11 1.45L14.4 0L16.3 3.2L19.9 4L19.55 7.7L22 10.5L19.55 13.3L19.9 17L16.3 17.8L14.4 21L11 19.55L7.6 21ZM8.45 18.45L11 17.35L13.6 18.45L15 16.05L17.75 15.4L17.5 12.6L19.35 10.5L17.5 8.35L17.75 5.55L15 4.95L13.55 2.55L11 3.65L8.4 2.55L7 4.95L4.25 5.55L4.5 8.35L2.65 10.5L4.5 12.6L4.25 15.45L7 16.05L8.45 18.45ZM9.95 14.05L15.6 8.4L14.2 6.95L9.95 11.2L7.8 9.1L6.4 10.5L9.95 14.05Z"),
  verifiedSolid: `<svg viewBox="0 0 22 21" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7.6 21L5.7 17.8L2.1 17L2.45 13.3L0 10.5L2.45 7.7L2.1 4L5.7 3.2L7.6 0L11 1.45L14.4 0L16.3 3.2L19.9 4L19.55 7.7L22 10.5L19.55 13.3L19.9 17L16.3 17.8L14.4 21L11 19.55Z"/><path d="m7 10.6 2.9 2.9L15.2 8.2" fill="none" stroke="var(--green, #194636)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  truck: glyph("11 14 26 20", "M17.25 33C16.3125 33 15.5156 32.6719 14.8594 32.0156C14.2031 31.3594 13.875 30.5625 13.875 29.625H11.625V17.25C11.625 16.6312 11.8453 16.1016 12.2859 15.6609C12.7266 15.2203 13.2562 15 13.875 15H29.625V19.5H33L36.375 24V29.625H34.125C34.125 30.5625 33.7969 31.3594 33.1406 32.0156C32.4844 32.6719 31.6875 33 30.75 33C29.8125 33 29.0156 32.6719 28.3594 32.0156C27.7031 31.3594 27.375 30.5625 27.375 29.625H20.625C20.625 30.5625 20.2969 31.3594 19.6406 32.0156C18.9844 32.6719 18.1875 33 17.25 33ZM17.25 30.75C17.5687 30.75 17.8359 30.6422 18.0516 30.4266C18.2672 30.2109 18.375 29.9437 18.375 29.625C18.375 29.3062 18.2672 29.0391 18.0516 28.8234C17.8359 28.6078 17.5687 28.5 17.25 28.5C16.9312 28.5 16.6641 28.6078 16.4484 28.8234C16.2328 29.0391 16.125 29.3062 16.125 29.625C16.125 29.9437 16.2328 30.2109 16.4484 30.4266C16.6641 30.6422 16.9312 30.75 17.25 30.75ZM13.875 27.375H14.775C15.0937 27.0375 15.4594 26.7656 15.8719 26.5594C16.2844 26.3531 16.7437 26.25 17.25 26.25C17.7562 26.25 18.2156 26.3531 18.6281 26.5594C19.0406 26.7656 19.4062 27.0375 19.725 27.375H27.375V17.25H13.875V27.375ZM30.75 30.75C31.0687 30.75 31.3359 30.6422 31.5516 30.4266C31.7672 30.2109 31.875 29.9437 31.875 29.625C31.875 29.3062 31.7672 29.0391 31.5516 28.8234C31.3359 28.6078 31.0687 28.5 30.75 28.5C30.4312 28.5 30.1641 28.6078 29.9484 28.8234C29.7328 29.0391 29.625 29.3062 29.625 29.625C29.625 29.9437 29.7328 30.2109 29.9484 30.4266C30.1641 30.6422 30.4312 30.75 30.75 30.75ZM29.625 25.125H34.4062L31.875 21.75H29.625V25.125Z"),
  pin: glyph("0 0 18 23", "M5.625 12.375H7.875V9.28125H10.125V12.375H12.375V7.03125L9 4.78125L5.625 7.03125V12.375ZM9 19.5187C11.2875 17.4187 12.9844 15.5109 14.0906 13.7953C15.1969 12.0797 15.75 10.5562 15.75 9.225C15.75 7.18125 15.0984 5.50781 13.7953 4.20469C12.4922 2.90156 10.8937 2.25 9 2.25C7.10625 2.25 5.50781 2.90156 4.20469 4.20469C2.90156 5.50781 2.25 7.18125 2.25 9.225C2.25 10.5562 2.80312 12.0797 3.90937 13.7953C5.01562 15.5109 6.7125 17.4187 9 19.5187ZM9 22.5C5.98125 19.9312 3.72656 17.5453 2.23594 15.3422C0.745312 13.1391 0 11.1 0 9.225C0 6.4125 0.904688 4.17187 2.71406 2.50312C4.52344 0.834375 6.61875 0 9 0C11.3812 0 13.4766 0.834375 15.2859 2.50312C17.0953 4.17187 18 6.4125 18 9.225C18 11.1 17.2547 13.1391 15.7641 15.3422C14.2734 17.5453 12.0187 19.9312 9 22.5Z"),
  external: glyph("0 0 16 16", "M1.49333 16L0 14.5067L12.3733 2.13333H5.33333V0H16V10.6667H13.8667V3.62667L1.49333 16Z"),
  arrow: glyph("0 0 18 18", "M13.6969 10.125H0V7.875H13.6969L7.39687 1.575L9 0L18 9L9 18L7.39687 16.425L13.6969 10.125Z"),
  receipt: glyph("0 0 18 20", "M3 20C2.16667 20 1.45833 19.7083 0.875 19.125C0.291667 18.5417 0 17.8333 0 17V14H3V0L4.5 1.5L6 0L7.5 1.5L9 0L10.5 1.5L12 0L13.5 1.5L15 0L16.5 1.5L18 0V17C18 17.8333 17.7083 18.5417 17.125 19.125C16.5417 19.7083 15.8333 20 15 20H3ZM15 18C15.2833 18 15.5208 17.9042 15.7125 17.7125C15.9042 17.5208 16 17.2833 16 17V3H5V14H14V17C14 17.2833 14.0958 17.5208 14.2875 17.7125C14.4792 17.9042 14.7167 18 15 18ZM6 7V5H12V7H6ZM6 10V8H12V10H6ZM14 7C13.7167 7 13.4792 6.90416 13.2875 6.7125C13.0958 6.52083 13 6.28333 13 6C13 5.71667 13.0958 5.47917 13.2875 5.2875C13.4792 5.09583 13.7167 5 14 5C14.2833 5 14.5208 5.09583 14.7125 5.2875C14.9042 5.47917 15 5.71667 15 6C15 6.28333 14.9042 6.52083 14.7125 6.7125C14.5208 6.90416 14.2833 7 14 7ZM14 10C13.7167 10 13.4792 9.90416 13.2875 9.7125C13.0958 9.52083 13 9.28333 13 9C13 8.71667 13.0958 8.47917 13.2875 8.2875C13.4792 8.09583 13.7167 8 14 8C14.2833 8 14.5208 8.09583 14.7125 8.2875C14.9042 8.47917 15 8.71667 15 9C15 9.28333 14.9042 9.52083 14.7125 9.7125C14.5208 9.90416 14.2833 10 14 10ZM3 18H12V16H2V17C2 17.2833 2.09583 17.5208 2.2875 17.7125C2.47917 17.9042 2.71667 18 3 18Z"),
  invoice: glyph("0 0 20 20", "M7 10.5H8V8.5H9C9.28333 8.5 9.52083 8.40416 9.7125 8.2125C9.90416 8.02083 10 7.78333 10 7.5V6.5C10 6.21667 9.90416 5.97917 9.7125 5.7875C9.52083 5.59583 9.28333 5.5 9 5.5H7V10.5ZM8 7.5V6.5H9V7.5H8ZM11 10.5H13C13.2833 10.5 13.5208 10.4042 13.7125 10.2125C13.9042 10.0208 14 9.78333 14 9.5V6.5C14 6.21667 13.9042 5.97917 13.7125 5.7875C13.5208 5.59583 13.2833 5.5 13 5.5H11V10.5ZM12 9.5V6.5H13V9.5H12ZM15 10.5H16V8.5H17V7.5H16V6.5H17V5.5H15V10.5ZM6 16C5.45 16 4.97917 15.8042 4.5875 15.4125C4.19583 15.0208 4 14.55 4 14V2C4 1.45 4.19583 0.979166 4.5875 0.5875C4.97917 0.195833 5.45 0 6 0H18C18.55 0 19.0208 0.195833 19.4125 0.5875C19.8042 0.979166 20 1.45 20 2V14C20 14.55 19.8042 15.0208 19.4125 15.4125C19.0208 15.8042 18.55 16 18 16H6ZM6 14H18V2H6V14ZM2 20C1.45 20 0.979166 19.8042 0.5875 19.4125C0.195833 19.0208 0 18.55 0 18V4H2V18H16V20H2Z"),
  headset: glyph("0 0 20 18", "M9 18V16H17V8.9C17 6.95 16.3208 5.29583 14.9625 3.9375C13.6042 2.57917 11.95 1.9 10 1.9C8.05 1.9 6.39583 2.57917 5.0375 3.9375C3.67917 5.29583 3 6.95 3 8.9V15H2C1.45 15 0.979166 14.8042 0.5875 14.4125C0.195833 14.0208 0 13.55 0 13V11C0 10.65 0.0875 10.3208 0.2625 10.0125C0.4375 9.70416 0.683333 9.45833 1 9.275L1.075 7.95C1.20833 6.81667 1.5375 5.76667 2.0625 4.8C2.5875 3.83333 3.24583 2.99167 4.0375 2.275C4.82917 1.55833 5.7375 1 6.7625 0.6C7.7875 0.2 8.86666 0 10 0C11.1333 0 12.2083 0.2 13.225 0.6C14.2417 1 15.15 1.55417 15.95 2.2625C16.75 2.97083 17.4083 3.80833 17.925 4.775C18.4417 5.74167 18.775 6.79167 18.925 7.925L19 9.225C19.3167 9.375 19.5625 9.6 19.7375 9.9C19.9125 10.2 20 10.5167 20 10.85V13.15C20 13.4833 19.9125 13.8 19.7375 14.1C19.5625 14.4 19.3167 14.625 19 14.775V16C19 16.55 18.8042 17.0208 18.4125 17.4125C18.0208 17.8042 17.55 18 17 18H9ZM7 11C6.71666 11 6.47917 10.9042 6.2875 10.7125C6.09583 10.5208 6 10.2833 6 10C6 9.71666 6.09583 9.47916 6.2875 9.2875C6.47917 9.09583 6.71666 9 7 9C7.28333 9 7.52083 9.09583 7.7125 9.2875C7.90417 9.47916 8 9.71666 8 10C8 10.2833 7.90417 10.5208 7.7125 10.7125C7.52083 10.9042 7.28333 11 7 11ZM13 11C12.7167 11 12.4792 10.9042 12.2875 10.7125C12.0958 10.5208 12 10.2833 12 10C12 9.71666 12.0958 9.47916 12.2875 9.2875C12.4792 9.09583 12.7167 9 13 9C13.2833 9 13.5208 9.09583 13.7125 9.2875C13.9042 9.47916 14 9.71666 14 10C14 10.2833 13.9042 10.5208 13.7125 10.7125C13.5208 10.9042 13.2833 11 13 11ZM4.025 9.45C3.90833 7.68333 4.44167 6.16667 5.625 4.9C6.80833 3.63333 8.28333 3 10.05 3C11.5333 3 12.8375 3.47083 13.9625 4.4125C15.0875 5.35417 15.7667 6.55833 16 8.025C14.4833 8.00833 13.0875 7.6 11.8125 6.8C10.5375 6 9.55833 4.91667 8.875 3.55C8.60833 4.88333 8.04583 6.07083 7.1875 7.1125C6.32916 8.15417 5.275 8.93333 4.025 9.45Z"),
  compass: glyph("17 17 26 26", "M22.7812 42.375L22.4375 39.35L26.3562 28.5562C26.7 28.8771 27.0724 29.1464 27.4734 29.3641C27.8745 29.5818 28.3042 29.7479 28.7625 29.8625L24.9812 40.2437L22.7812 42.375ZM37.2187 42.375L35.0187 40.2437L31.2375 29.8625C31.6958 29.7479 32.1255 29.5818 32.5266 29.3641C32.9276 29.1464 33.3 28.8771 33.6437 28.5562L37.5625 39.35L37.2187 42.375ZM30 28.625C28.8542 28.625 27.8802 28.224 27.0781 27.4219C26.276 26.6198 25.875 25.6458 25.875 24.5C25.875 23.6062 26.1328 22.8099 26.6484 22.1109C27.1641 21.412 27.8229 20.925 28.625 20.65V17.625H31.375V20.65C32.1771 20.925 32.8359 21.412 33.3516 22.1109C33.8672 22.8099 34.125 23.6062 34.125 24.5C34.125 25.6458 33.724 26.6198 32.9219 27.4219C32.1198 28.224 31.1458 28.625 30 28.625ZM30 25.875C30.3896 25.875 30.7161 25.7432 30.9797 25.4797C31.2432 25.2161 31.375 24.8896 31.375 24.5C31.375 24.1104 31.2432 23.7839 30.9797 23.5203C30.7161 23.2568 30.3896 23.125 30 23.125C29.6104 23.125 29.2839 23.2568 29.0203 23.5203C28.7568 23.7839 28.625 24.1104 28.625 24.5C28.625 24.8896 28.7568 25.2161 29.0203 25.4797C29.2839 25.7432 29.6104 25.875 30 25.875Z"),
  gift: glyph("0 0 20 19", "M2 15V17H18V15H2ZM2 4H4.2C4.11667 3.85 4.0625 3.69167 4.0375 3.525C4.0125 3.35833 4 3.18333 4 3C4 2.16667 4.29167 1.45833 4.875 0.875C5.45833 0.291667 6.16667 0 7 0C7.5 0 7.9625 0.129167 8.3875 0.3875C8.8125 0.645833 9.18333 0.966666 9.5 1.35L10 2L10.5 1.35C10.8 0.95 11.1667 0.625 11.6 0.375C12.0333 0.125 12.5 0 13 0C13.8333 0 14.5417 0.291667 15.125 0.875C15.7083 1.45833 16 2.16667 16 3C16 3.18333 15.9875 3.35833 15.9625 3.525C15.9375 3.69167 15.8833 3.85 15.8 4H18C18.55 4 19.0208 4.19583 19.4125 4.5875C19.8042 4.97917 20 5.45 20 6V17C20 17.55 19.8042 18.0208 19.4125 18.4125C19.0208 18.8042 18.55 19 18 19H2C1.45 19 0.979166 18.8042 0.5875 18.4125C0.195833 18.0208 0 17.55 0 17V6C0 5.45 0.195833 4.97917 0.5875 4.5875C0.979166 4.19583 1.45 4 2 4ZM2 12H18V6H12.9L15 8.85L13.4 10L10 5.4L6.6 10L5 8.85L7.05 6H2V12ZM7 4C7.28333 4 7.52083 3.90417 7.7125 3.7125C7.90417 3.52083 8 3.28333 8 3C8 2.71667 7.90417 2.47917 7.7125 2.2875C7.52083 2.09583 7.28333 2 7 2C6.71666 2 6.47917 2.09583 6.2875 2.2875C6.09583 2.47917 6 2.71667 6 3C6 3.28333 6.09583 3.52083 6.2875 3.7125C6.47917 3.90417 6.71666 4 7 4ZM13 4C13.2833 4 13.5208 3.90417 13.7125 3.7125C13.9042 3.52083 14 3.28333 14 3C14 2.71667 13.9042 2.47917 13.7125 2.2875C13.5208 2.09583 13.2833 2 13 2C12.7167 2 12.4792 2.09583 12.2875 2.2875C12.0958 2.47917 12 2.71667 12 3C12 3.28333 12.0958 3.52083 12.2875 3.7125C12.4792 3.90417 12.7167 4 13 4Z"),
  bag: stroke('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>'),
  specialist: stroke('<circle cx="9" cy="7" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M18 12.5V14M18 20v1.5M13.5 17H15M21 17h1.5M14.8 13.8l1 1M20.2 19.2l1 1M14.8 20.2l1-1M20.2 14.8l1-1"/>', 1.8),
  copy: glyph("0 0 17 20", "M6 16C5.45 16 4.97917 15.8042 4.5875 15.4125C4.19583 15.0208 4 14.55 4 14V2C4 1.45 4.19583 0.979167 4.5875 0.5875C4.97917 0.195833 5.45 0 6 0H15C15.55 0 16.0208 0.195833 16.4125 0.5875C16.8042 0.979167 17 1.45 17 2V14C17 14.55 16.8042 15.0208 16.4125 15.4125C16.0208 15.8042 15.55 16 15 16H6ZM6 14H15V2H6V14ZM2 20C1.45 20 0.979167 19.8042 0.5875 19.4125C0.195833 19.0208 0 18.55 0 18V4H2V18H13V20H2Z"),
  chevronUp: glyph("0 0 9 6", "M1.05 5.55L0 4.5L4.5 0L9 4.5L7.95 5.55L4.5 2.1L1.05 5.55Z"),
  camera: stroke('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>'),
  book: glyph("0 0 38.5 28", "M22.75 10.325V7.35C23.7125 6.94167 24.6969 6.63542 25.7031 6.43125C26.7094 6.22708 27.7667 6.125 28.875 6.125C29.6333 6.125 30.3771 6.18333 31.1062 6.3C31.8354 6.41667 32.55 6.5625 33.25 6.7375V9.5375C32.55 9.275 31.8427 9.07812 31.1281 8.94687C30.4135 8.81563 29.6625 8.75 28.875 8.75C27.7667 8.75 26.7021 8.88854 25.6812 9.16563C24.6604 9.44271 23.6833 9.82917 22.75 10.325ZM22.75 19.95V16.975C23.7125 16.5667 24.6969 16.2604 25.7031 16.0562C26.7094 15.8521 27.7667 15.75 28.875 15.75C29.6333 15.75 30.3771 15.8083 31.1062 15.925C31.8354 16.0417 32.55 16.1875 33.25 16.3625V19.1625C32.55 18.9 31.8427 18.7031 31.1281 18.5719C30.4135 18.4406 29.6625 18.375 28.875 18.375C27.7667 18.375 26.7021 18.5063 25.6812 18.7687C24.6604 19.0312 23.6833 19.425 22.75 19.95ZM22.75 15.1375V12.1625C23.7125 11.7542 24.6969 11.4479 25.7031 11.2437C26.7094 11.0396 27.7667 10.9375 28.875 10.9375C29.6333 10.9375 30.3771 10.9958 31.1062 11.1125C31.8354 11.2292 32.55 11.375 33.25 11.55V14.35C32.55 14.0875 31.8427 13.8906 31.1281 13.7594C30.4135 13.6281 29.6625 13.5625 28.875 13.5625C27.7667 13.5625 26.7021 13.701 25.6812 13.9781C24.6604 14.2552 23.6833 14.6417 22.75 15.1375ZM9.625 21C10.9958 21 12.3302 21.1531 13.6281 21.4594C14.926 21.7656 16.2167 22.225 17.5 22.8375V5.6C16.3042 4.9 15.0354 4.375 13.6938 4.025C12.3521 3.675 10.9958 3.5 9.625 3.5C8.575 3.5 7.53229 3.60208 6.49688 3.80625C5.46146 4.01042 4.4625 4.31667 3.5 4.725V22.05C4.52083 21.7 5.53438 21.4375 6.54063 21.2625C7.54688 21.0875 8.575 21 9.625 21ZM21 22.8375C22.2833 22.225 23.574 21.7656 24.8719 21.4594C26.1698 21.1531 27.5042 21 28.875 21C29.925 21 30.9531 21.0875 31.9594 21.2625C32.9656 21.4375 33.9792 21.7 35 22.05V4.725C34.0375 4.31667 33.0385 4.01042 32.0031 3.80625C30.9677 3.60208 29.925 3.5 28.875 3.5C27.5042 3.5 26.1479 3.675 24.8063 4.025C23.4646 4.375 22.1958 4.9 21 5.6V22.8375ZM19.25 28C17.85 26.8917 16.3333 26.0312 14.7 25.4188C13.0667 24.8062 11.375 24.5 9.625 24.5C8.4 24.5 7.19687 24.6604 6.01562 24.9813C4.83437 25.3021 3.70417 25.7542 2.625 26.3375C2.0125 26.6583 1.42188 26.6438 0.853125 26.2938C0.284375 25.9438 0 25.4333 0 24.7625V3.675C0 3.35417 0.0802083 3.04792 0.240625 2.75625C0.401042 2.46458 0.641667 2.24583 0.9625 2.1C2.30417 1.4 3.70417 0.875 5.1625 0.525C6.62083 0.175 8.10833 0 9.625 0C11.3167 0 12.9719 0.21875 14.5906 0.65625C16.2094 1.09375 17.7625 1.75 19.25 2.625C20.7375 1.75 22.2906 1.09375 23.9094 0.65625C25.5281 0.21875 27.1833 0 28.875 0C30.3917 0 31.8792 0.175 33.3375 0.525C34.7958 0.875 36.1958 1.4 37.5375 2.1C37.8583 2.24583 38.099 2.46458 38.2594 2.75625C38.4198 3.04792 38.5 3.35417 38.5 3.675V24.7625C38.5 25.4333 38.2156 25.9438 37.6469 26.2938C37.0781 26.6438 36.4875 26.6583 35.875 26.3375C34.7958 25.7542 33.6656 25.3021 32.4844 24.9813C31.3031 24.6604 30.1 24.5 28.875 24.5C27.125 24.5 25.4333 24.8062 23.8 25.4188C22.1667 26.0312 20.65 26.8917 19.25 28Z"),
  shield: glyph("0 0 28 35", "M12.1625 23.7125L22.05 13.825L19.5563 11.3313L12.1625 18.725L8.4875 15.05L5.99375 17.5438L12.1625 23.7125ZM14 35C9.94583 33.9792 6.59896 31.6531 3.95937 28.0219C1.31979 24.3906 0 20.3583 0 15.925V5.25L14 0L28 5.25V15.925C28 20.3583 26.6802 24.3906 24.0406 28.0219C21.401 31.6531 18.0542 33.9792 14 35ZM14 31.325C17.0333 30.3625 19.5417 28.4375 21.525 25.55C23.5083 22.6625 24.5 19.4542 24.5 15.925V7.65625L14 3.71875L3.5 7.65625V15.925C3.5 19.4542 4.49167 22.6625 6.475 25.55C8.45833 28.4375 10.9667 30.3625 14 31.325Z"),
  clipboardCheck: glyph("0 0 22.5 25", "M9.5 18.8125L18.3125 10L16.5625 8.25L9.5 15.3125L5.9375 11.75L4.1875 13.5L9.5 18.8125ZM2.5 25C1.8125 25 1.22396 24.7552 0.734375 24.2656C0.244792 23.776 0 23.1875 0 22.5V5C0 4.3125 0.244792 3.72396 0.734375 3.23438C1.22396 2.74479 1.8125 2.5 2.5 2.5H7.75C8.02083 1.75 8.47396 1.14583 9.10938 0.6875C9.74479 0.229167 10.4583 0 11.25 0C12.0417 0 12.7552 0.229167 13.3906 0.6875C14.026 1.14583 14.4792 1.75 14.75 2.5H20C20.6875 2.5 21.276 2.74479 21.7656 3.23438C22.2552 3.72396 22.5 4.3125 22.5 5V22.5C22.5 23.1875 22.2552 23.776 21.7656 24.2656C21.276 24.7552 20.6875 25 20 25H2.5ZM2.5 22.5H20V5H2.5V22.5ZM11.25 4.0625C11.5208 4.0625 11.7448 3.97396 11.9219 3.79688C12.099 3.61979 12.1875 3.39583 12.1875 3.125C12.1875 2.85417 12.099 2.63021 11.9219 2.45312C11.7448 2.27604 11.5208 2.1875 11.25 2.1875C10.9792 2.1875 10.7552 2.27604 10.5781 2.45312C10.401 2.63021 10.3125 2.85417 10.3125 3.125C10.3125 3.39583 10.401 3.61979 10.5781 3.79688C10.7552 3.97396 10.9792 4.0625 11.25 4.0625Z"),
  clock: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
};

// Small white glyphs inside the timeline's green dots.
const UPDATE_ICON: Record<UpdateKind, string> = {
  delivered: stroke('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 3),
  out: stroke('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>', 2.4),
  shipped: stroke('<path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/>', 2.6),
  packing: stroke('<path d="M3 7h18v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM2 3h20v4H2zM10 11h4"/>', 2.4),
  production: stroke('<path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9M17.64 15 22 10.64M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/>', 2.4),
  alert: stroke('<path d="M12 8v5M12 16.5v.01"/>', 3),
};

/** Headline copy for where the deck is now. */
export const STEP_COPY: Record<DeckStep, { pill: string; title: string; text: string }> = {
  production: {
    pill: "In production",
    title: "Your deck is now in production.",
    text: "Every A-DIY deck is made just for you, nothing sits in a warehouse.",
  },
  packing: {
    pill: "Ready to ship",
    title: "Getting your deck ready to ship.",
    text: "We're packing and securing everything for its trip to you.",
  },
  shipped: {
    pill: "Shipped",
    title: "Your deck is on its way.",
    text: "Your deck ships by LTL freight. The carrier will call you to schedule delivery once it reaches your local terminal.",
  },
  delivered: {
    pill: "Delivered",
    title: "Your deck has arrived.",
    text: "Please check all parts within 14 days of delivery.",
  },
};

const STEPS = [
  { label: "Production", text: "Your deck is made and quality checked.", now: "Your deck is being made and quality checked." },
  { label: "Ready to ship", text: "Everything is packed and secured.", now: "We're packing and securing everything." },
  { label: "Shipped", text: "Your deck is on its way." },
  { label: "Delivered", text: "Your deck has arrived.", todo: "Your deck arrives at your property." },
];

type StepState = "done" | "current" | "todo";
const stateOf = (i: number, p: DeckProgress): StepState => {
  const now = ORDER.indexOf(p.step);
  return i < now || p.step === "delivered" ? "done" : i === now ? "current" : "todo";
};

/** The date line under each stage: real dates only, otherwise where it stands. */
function stepWhen(order: HubOrder, p: DeckProgress, i: number, state: StepState) {
  const packedAt = order.fulfillments[0]?.createdAt;
  if (i === 0) return state === "current" ? `${p.percent}% complete` : `Ordered ${fmtShort(order.createdAt)}`;
  if (i === 1) {
    if (state === "current") return `${p.percent}% complete`;
    if (state === "done") return packedAt ? `Completed ${fmtShort(packedAt)}` : "Completed";
    return "Up next";
  }
  if (i === 2) {
    if (state === "todo") return p.step === "packing" ? "Up next" : "Not yet shipped";
    return p.shippedAt ? `${p.step === "delivered" ? "Shipped" : "In transit"} ${fmtShort(p.shippedAt)}` : "In transit";
  }
  if (p.deliveredAt) return `Delivered ${fmtShort(p.deliveredAt)} · ${fmtTime(p.deliveredAt)}`;
  const eta = order.fulfillments.find((f) => f.estimatedDeliveryAt)?.estimatedDeliveryAt;
  return eta ? `Estimated ${fmtShort(eta)}` : "Not yet delivered";
}

/** Overview: the four stage cards (Production → Ready to Ship → Shipped → Delivered) from the Figma. */
export function progressStrip(order: HubOrder, p: DeckProgress) {
  const now = ORDER.indexOf(p.step);
  const cards = STEPS.map((s, i) => {
    const state = stateOf(i, p);
    const here = i === now;
    const mark = here ? (state === "done" ? GLYPH.verifiedSolid : `<i class="trk-pulse"></i>`) : state === "done" ? GLYPH.checkCircle : `<i class="trk-ring"></i>`;
    const text = state === "current" && s.now ? s.now : state === "todo" && s.todo ? s.todo : s.text;
    return `<div class="trk-card ${state}${here ? " here" : ""}">
        <div class="trk-card-head"><span>${String(i + 1).padStart(2, "0")} · ${s.label}</span><span class="trk-mark">${mark}</span></div>
        <div class="trk-card-bar">${state === "current" ? `<span style="width:${Math.max(8, p.percent)}%"></span>` : ""}</div>
        <p>${text}</p>
        <small>${esc(stepWhen(order, p, i, state))}</small>
      </div>`;
  }).join("");
  return `<div class="trk-cards">${cards}</div>`;
}

/** Track My Deck: the thin four-step line under the status header. */
export function progressLine(order: HubOrder, p: DeckProgress) {
  const now = ORDER.indexOf(p.step);
  return `<ol class="trk-line">${STEPS.map((s, i) => {
    const state = stateOf(i, p);
    const here = i === now;
    const mark = state === "done" ? (here ? GLYPH.verified : GLYPH.check) : state === "current" ? `<i class="trk-pulse"></i>` : "";
    return `<li class="${state}${here ? " here" : ""}">
        <div class="trk-line-bar">${state === "current" ? `<span style="width:${Math.max(6, p.percent)}%"></span>` : ""}</div>
        <div class="trk-line-head"><b>${i + 1}. ${s.label}</b><span class="trk-mark">${mark}</span></div>
        <small>${esc(stepWhen(order, p, i, state))}</small>
      </li>`;
  }).join("")}</ol>`;
}

/** Thin bar + percentage while the deck is still with us (production and packing). */
export function percentBar(p: DeckProgress) {
  if (p.step !== "production" && p.step !== "packing") return "";
  return `<div class="track-percent"><b>${p.percent}%</b> <span class="muted">of your deck is completed.</span>
    ${p.eta ? `<span class="pill mint dot">${esc(p.eta)}</span>` : ""}</div>
    <div class="meter" style="height:8px"><span style="width:${p.percent}%"></span></div>`;
}

/** Carrier + tracking numbers: Shopify's tracking info, if the fulfillment has any. */
export function shopifyTracking(order: HubOrder) {
  return order.fulfillments.flatMap((f) => f.trackingInfo).filter((t) => t.number || t.url);
}

/** Where to follow the shipment: Shopify's tracking link if it has one, else the LTL carrier's page. */
export const liveTrackingUrl = (order: HubOrder) =>
  shopifyTracking(order).find((t) => t.url)?.url ?? carrierTrackingUrl(order.name);

/** Overview subtitle under "Your deck's progress": tracking ID and carrier, or an honest note before shipping. */
export function carrierLine(order: HubOrder, p: DeckProgress) {
  const t = shopifyTracking(order)[0];
  const carrier = t?.company ?? "LTL freight";
  if (p.step !== "shipped" && p.step !== "delivered") return `Order ${esc(orderNo(order.name))} · Tracking ID available once your deck ships`;
  return t?.number
    ? `Milestone tracking ID: #${esc(t.number.replace(/^#/, ""))} · Carrier: ${esc(carrier)}`
    : `Order ${esc(orderNo(order.name))} · Carrier: ${esc(carrier)}`;
}

/** Track My Deck: the Carrier & Tracking Details and Delivery Confirmation cards, at every stage. */
export function carrierCards(order: HubOrder, p: DeckProgress) {
  const shipped = p.step === "shipped" || p.step === "delivered";
  const t = shopifyTracking(order)[0];
  const live = liveTrackingUrl(order);
  const eta = order.fulfillments.find((f) => f.estimatedDeliveryAt)?.estimatedDeliveryAt;

  const carrier = shipped
    ? `<div class="label">Carrier &amp; tracking details</div>
        <div class="trk-info-big">${esc(t?.company ?? "LTL freight")}</div>
        <div class="trk-mono">${esc(t?.number ?? `Order ${orderNo(order.name)}`)}</div>
        ${t?.number ? `<div class="trk-info-actions"><button class="trk-chip" type="button" data-copy-value="${esc(t.number)}">${GLYPH.copy}<span>Copy tracking number</span></button></div>` : ""}`
    : `<div class="label">Carrier &amp; tracking details</div>
        <div class="trk-info-big">LTL freight</div>
        <p class="trk-info-text">Your carrier and tracking number will appear here once your deck ships.</p>
        <span class="trk-pending">${GLYPH.clock}Available once your deck ships</span>`;

  const delivery = p.deliveredAt
    ? `<div class="label">Delivery confirmation</div>
        <div class="trk-info-big">${fmtStamp(p.deliveredAt)}</div>
        <p class="trk-info-text">Your carrier has confirmed delivery to your property.</p>
        <a class="trk-link" href="${esc(live)}" target="_blank" rel="noopener">${GLYPH.camera}<span>View delivery record</span></a>`
    : `<div class="label">Delivery confirmation</div>
        <div class="trk-info-big">${shipped ? (eta ? `Estimated ${esc(fmtShort(eta))}` : "On its way") : "Not yet delivered"}</div>
        <p class="trk-info-text">${
          shipped
            ? "The carrier will call you to schedule delivery once your deck reaches your local terminal."
            : "Once your carrier delivers your deck, the date and time will be confirmed here."
        }</p>
        <span class="trk-pending">${GLYPH.clock}Pending delivery</span>`;

  return `<div class="trk-info">
      <div class="trk-info-card${shipped ? "" : " pending"}">${carrier}</div>
      <div class="trk-info-card${p.deliveredAt ? "" : " pending"}">${delivery}</div>
    </div>`;
}

export interface TimelineItem {
  /** Extra classes on the row: "now" (gold node) or "todo" (hollow node). */
  cls?: string;
  icon: string;
  title: string;
  text: string;
  when: string;
}

/** The Figma timeline: grey cards on a continuous green connector, icon nodes, date on the right. */
export function timelineList(items: TimelineItem[]) {
  return `<ol class="trk-timeline">${items
    .map(
      (it) => `<li${it.cls ? ` class="${it.cls}"` : ""}>
        <span class="trk-tl-dot">${it.icon}</span>
        <div class="trk-tl-body">
          <div class="trk-tl-head"><b>${it.title}</b><small>${it.when}</small></div>
          <p>${it.text}</p>
        </div>
      </li>`,
    )
    .join("")}</ol>`;
}

/** Track My Deck, while in production: the theme's build checklist, in the timeline style. */
export function checklistTimeline(p: DeckProgress) {
  return timelineList(
    PRODUCTION_CHECKLIST.map((c, i) => {
      const done = i < p.checklistDone;
      const now = i === p.checklistDone;
      return {
        cls: done ? undefined : now ? "now" : "todo",
        icon: done ? UPDATE_ICON.delivered : now ? UPDATE_ICON.production : "",
        title: c.title,
        text: c.text,
        when: done ? "Completed" : now ? "In progress" : "Up next",
      };
    }),
  );
}

/** Track My Deck: "Your order updates", newest first, collapsible without JS. */
export function updatesTimeline(order: HubOrder, p: DeckProgress) {
  const items = timelineList(
    orderUpdates(order, p).map((u) => ({
      cls: `trk-tl-${u.kind}${u.at ? "" : " now"}`,
      icon: UPDATE_ICON[u.kind],
      title: u.title,
      text: u.text,
      when: u.at ? fmtStamp(u.at) : "In progress",
    })),
  );
  return `<details class="trk-updates" open>
      <summary>
        <div><h2 class="h2">Your order updates</h2><p class="muted">See your deck's progress from production to delivery.</p></div>
        <span class="trk-toggle"><span class="trk-when-open">Collapse timeline</span><span class="trk-when-closed">Expand timeline</span>${GLYPH.chevronUp}</span>
      </summary>
      ${items}
    </details>`;
}
