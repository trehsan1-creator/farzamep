import test from "node:test";
import assert from "node:assert/strict";
import {
  addGregorianDays,
  calculateSalesLine,
  calculateSalesTotals,
  formatSalesDocumentNumber,
  gregorianToJalali,
} from "./salesEngine";

test("calculates 10 percent VAT in integer Rials without floating point drift", () => {
  const line = calculateSalesLine({
    quantity: "3",
    unitPriceRial: "100000",
    discountRial: "0",
    vatRatePct: "10",
    isVatSubject: true,
  });
  assert.deepEqual(line, {
    subtotalRial: 300000,
    discountRial: 0,
    netRial: 300000,
    vatRial: 30000,
    totalRial: 330000,
  });
});

test("applies line discount before VAT and rounds the tax to the nearest Rial", () => {
  const line = calculateSalesLine({
    quantity: "2",
    unitPriceRial: "100000",
    discountRial: "15000",
    vatRatePct: "10",
    isVatSubject: true,
  });
  assert.equal(line.subtotalRial, 200000);
  assert.equal(line.netRial, 185000);
  assert.equal(line.vatRial, 18500);
  assert.equal(line.totalRial, 203500);
});

test("keeps VAT exempt items at zero tax even when a default rate is present", () => {
  const line = calculateSalesLine({
    quantity: "1",
    unitPriceRial: "250000",
    vatRatePct: "10",
    isVatSubject: false,
  });
  assert.equal(line.vatRial, 0);
  assert.equal(line.totalRial, 250000);
});

test("supports exact three-decimal quantities", () => {
  const line = calculateSalesLine({
    quantity: "1.250",
    unitPriceRial: "80000",
    vatRatePct: "0",
    isVatSubject: false,
  });
  assert.equal(line.subtotalRial, 100000);
  assert.equal(line.totalRial, 100000);
});

test("rejects negative prices and discounts larger than the line subtotal", () => {
  assert.throws(() => calculateSalesLine({
    quantity: 1, unitPriceRial: -1, isVatSubject: false,
  }), /cannot be negative/);
  assert.throws(() => calculateSalesLine({
    quantity: 1, unitPriceRial: 100, discountRial: 101, isVatSubject: false,
  }), /cannot exceed/);
});

test("aggregates multiple lines using integer Rial totals", () => {
  const result = calculateSalesTotals([
    { quantity: 1, unitPriceRial: 100000, vatRatePct: 10, isVatSubject: true },
    { quantity: 2, unitPriceRial: 50000, vatRatePct: 0, isVatSubject: false },
  ]);
  assert.equal(result.subtotalRial, 200000);
  assert.equal(result.vatRial, 10000);
  assert.equal(result.totalRial, 210000);
});

test("formats stable per-year quotation and invoice numbers", () => {
  assert.equal(formatSalesDocumentNumber("QUOTE", "1405", 12), "P-1405-000012");
  assert.equal(formatSalesDocumentNumber("INVOICE", "1405", 12), "S-1405-000012");
});

test("adds Gregorian due dates without local timezone drift", () => {
  assert.equal(addGregorianDays("2026-11-27", 30), "2026-12-27");
  assert.match(gregorianToJalali("2026-11-27"), /^1405\/09\/\d{2}$/);
});
