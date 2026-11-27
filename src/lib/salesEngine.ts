export interface SalesLineCalculationInput {
  quantity: string | number;
  unitPriceRial: string | number;
  discountRial?: string | number;
  vatRatePct?: string | number;
  isVatSubject: boolean;
}

export interface SalesLineCalculation {
  subtotalRial: number;
  discountRial: number;
  netRial: number;
  vatRial: number;
  totalRial: number;
}

function toIntegerBigInt(value: string | number | undefined, label: string): bigint {
  const normalized = String(value ?? "0").replace(/[٬,،\s_]/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!/^-?\d+$/.test(normalized)) throw new RangeError(label + " must be an integer");
  return BigInt(normalized);
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Rial amount exceeds JavaScript safe integer range");
  }
  return Number(value);
}

export function calculateSalesLine(input: SalesLineCalculationInput): SalesLineCalculation {
  const quantityNumber = Number(input.quantity);
  const rateNumber = Number(input.vatRatePct ?? 0);
  if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) throw new RangeError("Quantity must be positive");
  if (!Number.isFinite(rateNumber) || rateNumber < 0 || rateNumber > 100) throw new RangeError("VAT rate must be between 0 and 100");

  const quantityMilli = BigInt(Math.round(quantityNumber * 1000));
  const unitPrice = toIntegerBigInt(input.unitPriceRial, "Unit price");
  const discount = toIntegerBigInt(input.discountRial ?? 0, "Discount");
  if (unitPrice < 0n || discount < 0n) throw new RangeError("Price and discount cannot be negative");

  const subtotal = (quantityMilli * unitPrice + 500n) / 1000n;
  if (discount > subtotal) throw new RangeError("Discount cannot exceed line subtotal");
  const net = subtotal - discount;
  const rateBasisPoints = BigInt(Math.round(rateNumber * 100));
  const vat = input.isVatSubject ? (net * rateBasisPoints + 5000n) / 10000n : 0n;
  const total = net + vat;

  return {
    subtotalRial: safeNumber(subtotal),
    discountRial: safeNumber(discount),
    netRial: safeNumber(net),
    vatRial: safeNumber(vat),
    totalRial: safeNumber(total),
  };
}

export function calculateSalesTotals(lines: SalesLineCalculationInput[]) {
  const calculated = lines.map(calculateSalesLine);
  const totals = calculated.reduce(
    (sum, line) => ({
      subtotalRial: sum.subtotalRial + line.subtotalRial,
      discountRial: sum.discountRial + line.discountRial,
      netRial: sum.netRial + line.netRial,
      vatRial: sum.vatRial + line.vatRial,
      totalRial: sum.totalRial + line.totalRial,
    }),
    { subtotalRial: 0, discountRial: 0, netRial: 0, vatRial: 0, totalRial: 0 }
  );
  for (const value of Object.values(totals)) {
    if (!Number.isSafeInteger(value)) throw new RangeError("Sales total exceeds JavaScript safe integer range");
  }
  return { lines: calculated, ...totals };
}

export function formatSalesDocumentNumber(documentType: "QUOTE" | "INVOICE", fiscalYearCode: string, number: number): string {
  const prefix = documentType === "QUOTE" ? "P" : "S";
  return prefix + "-" + fiscalYearCode + "-" + String(number).padStart(6, "0");
}

function dateParts(date: Date, calendar: "gregory" | "persian", timeZone: string) {
  const locale = calendar === "persian" ? "en-US-u-ca-persian-nu-latn" : "en-US-u-nu-latn";
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { year: part("year"), month: part("month").padStart(2, "0"), day: part("day").padStart(2, "0") };
}

export function getTehranToday() {
  const gregorian = dateParts(new Date(), "gregory", "Asia/Tehran");
  const persian = dateParts(new Date(), "persian", "Asia/Tehran");
  return {
    gregorian: gregorian.year + "-" + gregorian.month + "-" + gregorian.day,
    jalali: persian.year + "/" + persian.month + "/" + persian.day,
  };
}

export function gregorianToJalali(isoDate: string): string {
  if (!isoDate) return "";
  const date = new Date(isoDate + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return "";
  const parts = dateParts(date, "persian", "Asia/Tehran");
  return parts.year + "/" + parts.month + "/" + parts.day;
}

export function addGregorianDays(isoDate: string, days: number): string {
  if (!isoDate) return "";
  const date = new Date(isoDate + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
