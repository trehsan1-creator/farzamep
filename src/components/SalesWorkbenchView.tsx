import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowDown, ArrowUp, Check, ChevronDown, FilePlus2, FileText,
  Loader2, Package, Plus, Printer, RefreshCw, Save, Search, Settings2,
  ShoppingCart, Trash2, Wallet, X,
} from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import { getSupabaseClient } from '../lib/supabase';
import { formatCurrency, parseRialInteger, toEnglishDigits, toPersianDigits } from '../lib/persian';
import {
  addGregorianDays, calculateSalesTotals, formatSalesDocumentNumber,
  getTehranToday, gregorianToJalali,
} from '../lib/salesEngine';

type DocumentType = 'QUOTE' | 'INVOICE';
type SalesTab = 'documents' | 'inventory' | 'settings';
type DraftLine = {
  key: string;
  product_id: string;
  description: string;
  unit_fa: string;
  quantity: string;
  unit_price_rial: string;
  discount_rial: string;
  is_vat_subject: boolean;
  vat_rate_pct: string;
};
type SalesDocument = Record<string, any>;
type ProductRow = Record<string, any>;
type PartyRow = Record<string, any>;
type WarehouseRow = Record<string, any>;
type SettingsRow = Record<string, any>;

const INPUT = 'w-full rounded-xl border border-white/10 bg-[#0C1D2C] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#FF9B45] focus:ring-2 focus:ring-[#FF9B45]/15 placeholder:text-slate-500';
const SELECT = INPUT + ' cursor-pointer';
const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45';
const PRIMARY = BUTTON + ' bg-[#FF9B45] text-[#172B3B] hover:bg-[#FFB36F]';
const SECONDARY = BUTTON + ' border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]';
const MUTED = 'text-xs text-slate-400';
const EMPTY_TOTALS = { subtotalRial: 0, discountRial: 0, netRial: 0, vatRial: 0, totalRial: 0 };

function newLine(settings?: SettingsRow | null): DraftLine {
  return {
    key: crypto.randomUUID(),
    product_id: '',
    description: '',
    unit_fa: 'عدد',
    quantity: '1',
    unit_price_rial: '',
    discount_rial: '0',
    is_vat_subject: true,
    vat_rate_pct: String(settings?.default_vat_rate_pct ?? 10),
  };
}

function documentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'پیش‌نویس',
    SENT: 'ارسال‌شده',
    ACCEPTED: 'تأیید مشتری',
    REJECTED: 'ردشده',
    EXPIRED: 'منقضی',
    CONVERTED: 'تبدیل‌شده',
    ISSUED: 'صادرشده',
    PARTIALLY_PAID: 'تسویه جزئی',
    PAID: 'تسویه کامل',
    CANCELLED: 'لغوشده',
  };
  return labels[status] ?? status;
}

function statusClass(status: string): string {
  if (status === 'PAID' || status === 'ACCEPTED') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  if (status === 'ISSUED' || status === 'SENT') return 'border-sky-400/20 bg-sky-400/10 text-sky-300';
  if (status === 'PARTIALLY_PAID') return 'border-amber-400/20 bg-amber-400/10 text-amber-300';
  if (status === 'CANCELLED' || status === 'REJECTED' || status === 'EXPIRED') return 'border-rose-400/20 bg-rose-400/10 text-rose-300';
  return 'border-white/10 bg-white/[0.04] text-slate-300';
}

function docNumber(doc: SalesDocument, fiscalYearCode: string): string {
  return formatSalesDocumentNumber(doc.document_type, fiscalYearCode, Number(doc.document_no));
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: unknown, unit: 'RIAL' | 'TOMAN'): string {
  return formatCurrency(asNumber(value), unit, { showUnit: true });
}

function JalaliDate({ value }: { value?: string | null }) {
  return <span className="num-ltr whitespace-nowrap">{value ? toPersianDigits(value) : '—'}</span>;
}

export function SalesWorkbenchView() {
  const { activeFiscalYear, currencyUnit, isReadOnly } = useFiscalYear();
  const [tab, setTab] = useState<SalesTab>('documents');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SalesDocument[]>([]);
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [bankParties, setBankParties] = useState<PartyRow[]>([]);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [stockRows, setStockRows] = useState<Array<Record<string, any>>>([]);
  const [filterType, setFilterType] = useState<'ALL' | DocumentType>('ALL');
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<SalesDocument | null>(null);
  const [detailDocumentId, setDetailDocumentId] = useState<string | null>(null);
  const [paymentDocumentId, setPaymentDocumentId] = useState<string | null>(null);
  const [printDocument, setPrintDocument] = useState<SalesDocument | null>(null);
  const [form, setForm] = useState({
    document_type: 'QUOTE' as DocumentType,
    party_id: '',
    issue_date_gregorian: '',
    issue_date_jalali: '',
    due_date_gregorian: '',
    due_date_jalali: '',
    valid_until_gregorian: '',
    valid_until_jalali: '',
    warehouse_id: '',
    notes: '',
    terms: '',
    lines: [] as DraftLine[],
  });
  const [paymentForm, setPaymentForm] = useState({
    amount_rial: '',
    payment_method: 'BANK_TRANSFER',
    bank_tafsil_id: '',
    reference_no: '',
    payment_date_gregorian: '',
    payment_date_jalali: '',
  });
  const [settingsForm, setSettingsForm] = useState({
    seller_name: '',
    seller_national_id: '',
    seller_economic_code: '',
    seller_registration_no: '',
    seller_address: '',
    seller_postal_code: '',
    seller_phone: '',
    seller_bank_name: '',
    seller_iban: '',
    default_vat_rate_pct: '10',
  });
  const [productEditor, setProductEditor] = useState<ProductRow | null>(null);
  const [productForm, setProductForm] = useState({
    sale_price_rial: '',
    is_vat_subject: true,
    vat_rate_pct: '',
    track_inventory: false,
  });
  const [adjustmentProduct, setAdjustmentProduct] = useState<ProductRow | null>(null);
  const [adjustmentForm, setAdjustmentForm] = useState({
    warehouse_id: '',
    quantity_delta: '',
    movement_type: 'OPENING',
    unit_cost_rial: '',
    note: '',
  });

  const loadData = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError('اتصال Supabase در این محیط پیکربندی نشده است.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const [docsResult, partiesResult, productsResult, warehousesResult, settingsResult, stockResult, banksResult] = await Promise.all([
      supabase.from('sales_documents')
        .select('id,fiscal_year_id,document_type,document_no,status,party_id,source_quote_id,warehouse_id,issue_date_gregorian,issue_date_jalali,due_date_gregorian,due_date_jalali,valid_until_gregorian,valid_until_jalali,notes,terms,party_name_snapshot,party_national_id_snapshot,party_economic_code_snapshot,party_address_snapshot,party_postal_code_snapshot,party_phone_snapshot,seller_name_snapshot,seller_national_id_snapshot,seller_economic_code_snapshot,seller_registration_no_snapshot,seller_address_snapshot,seller_postal_code_snapshot,seller_phone_snapshot,seller_bank_name_snapshot,seller_iban_snapshot,subtotal_rial,discount_rial,tax_rial,total_rial,paid_rial,balance_rial,voucher_id,created_by_actor,created_at,lines:sales_document_lines(id,line_no,product_id,product_code_snapshot,description,unit_fa,quantity,unit_price_rial,discount_rial,is_vat_subject,vat_rate_pct,line_subtotal_rial,line_net_rial,vat_amount_rial,line_total_rial,track_inventory),payments:sales_document_payments(id,amount_rial,payment_date_gregorian,payment_date_jalali,payment_method,reference_no,voucher_id)')
        .eq('fiscal_year_id', activeFiscalYear.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('tafsil_parties')
        .select('id,tafsil_code,full_name,national_id,economic_code,iban,metadata,party_type,is_active')
        .eq('party_type', 'CUSTOMER').eq('is_active', true).order('full_name'),
      supabase.from('products')
        .select('id,product_code,name_fa,unit_fa,is_vat_subject,sale_price_rial,vat_rate_pct,track_inventory,is_active')
        .eq('is_active', true).order('name_fa'),
      supabase.from('inventory_warehouses').select('id,code,name_fa').eq('is_active', true).order('name_fa'),
      supabase.from('sales_settings').select('*').eq('id', true).single(),
      supabase.from('inventory_stock').select('warehouse_id,product_id,quantity_on_hand'),
      supabase.from('tafsil_parties')
        .select('id,tafsil_code,full_name,iban,metadata,party_type,is_active')
        .eq('party_type', 'BANK').eq('is_active', true).order('full_name'),
    ]);

    const failed = [docsResult, partiesResult, productsResult, warehousesResult, settingsResult, stockResult, banksResult]
      .find((result) => result.error);
    if (failed?.error) {
      setError('خطا در دریافت اطلاعات فروش: ' + failed.error.message);
      setLoading(false);
      return;
    }

    setDocuments((docsResult.data ?? []) as SalesDocument[]);
    setParties((partiesResult.data ?? []) as PartyRow[]);
    setProducts((productsResult.data ?? []) as ProductRow[]);
    setWarehouses((warehousesResult.data ?? []) as WarehouseRow[]);
    setSettings((settingsResult.data ?? null) as SettingsRow | null);
    setStockRows((stockResult.data ?? []) as Array<Record<string, any>>);
    setBankParties((banksResult.data ?? []) as PartyRow[]);
    setSettingsForm({
      seller_name: settingsResult.data?.seller_name ?? '',
      seller_national_id: settingsResult.data?.seller_national_id ?? '',
      seller_economic_code: settingsResult.data?.seller_economic_code ?? '',
      seller_registration_no: settingsResult.data?.seller_registration_no ?? '',
      seller_address: settingsResult.data?.seller_address ?? '',
      seller_postal_code: settingsResult.data?.seller_postal_code ?? '',
      seller_phone: settingsResult.data?.seller_phone ?? '',
      seller_bank_name: settingsResult.data?.seller_bank_name ?? '',
      seller_iban: settingsResult.data?.seller_iban ?? '',
      default_vat_rate_pct: String(settingsResult.data?.default_vat_rate_pct ?? 10),
    });
    setLoading(false);
  }, [activeFiscalYear.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!printDocument) return;
    const timer = window.setTimeout(() => window.print(), 250);
    const afterPrint = () => setPrintDocument(null);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [printDocument]);

  const totals = useMemo(() => {
    try {
      return calculateSalesTotals(form.lines.map((line) => ({
        quantity: line.quantity || '0',
        unitPriceRial: line.unit_price_rial || '0',
        discountRial: line.discount_rial || '0',
        vatRatePct: line.vat_rate_pct || '0',
        isVatSubject: line.is_vat_subject,
      })));
    } catch {
      return { ...EMPTY_TOTALS, lines: [] };
    }
  }, [form.lines]);

  const selectedDocument = documents.find((doc) => doc.id === detailDocumentId) ?? null;
  const paymentDocument = documents.find((doc) => doc.id === paymentDocumentId) ?? null;
  const filteredDocuments = documents.filter((doc) => {
    if (filterType !== 'ALL' && doc.document_type !== filterType) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return String(doc.document_no).includes(needle)
      || String(doc.party_name_snapshot ?? '').toLowerCase().includes(needle)
      || String(doc.status ?? '').toLowerCase().includes(needle);
  });
  const invoices = documents.filter((doc) => doc.document_type === 'INVOICE' && ['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(doc.status));
  const outstanding = invoices.reduce((sum, doc) => sum + asNumber(doc.balance_rial), 0);
  const issuedSales = invoices.reduce((sum, doc) => sum + asNumber(doc.total_rial), 0);
  const pendingQuotes = documents.filter((doc) => doc.document_type === 'QUOTE' && ['DRAFT', 'SENT', 'ACCEPTED'].includes(doc.status)).length;

  const notify = (text: string) => {
    setMessage(text);
    setError(null);
  };

  const startCreate = (type: DocumentType) => {
    const today = getTehranToday();
    const expiry = addGregorianDays(today.gregorian, 7);
    setEditingDocument(null);
    setForm({
      document_type: type,
      party_id: '',
      issue_date_gregorian: today.gregorian,
      issue_date_jalali: today.jalali,
      due_date_gregorian: type === 'INVOICE' ? addGregorianDays(today.gregorian, 30) : '',
      due_date_jalali: type === 'INVOICE' ? gregorianToJalali(addGregorianDays(today.gregorian, 30)) : '',
      valid_until_gregorian: type === 'QUOTE' ? expiry : '',
      valid_until_jalali: type === 'QUOTE' ? gregorianToJalali(expiry) : '',
      warehouse_id: warehouses[0]?.id ?? '',
      notes: '',
      terms: '',
      lines: [newLine(settings)],
    });
    setEditorOpen(true);
    setMessage(null);
    setError(null);
  };

  const startEdit = (doc: SalesDocument) => {
    setEditingDocument(doc);
    setForm({
      document_type: doc.document_type,
      party_id: doc.party_id,
      issue_date_gregorian: doc.issue_date_gregorian,
      issue_date_jalali: doc.issue_date_jalali?.trim?.() ?? doc.issue_date_jalali,
      due_date_gregorian: doc.due_date_gregorian ?? '',
      due_date_jalali: doc.due_date_jalali?.trim?.() ?? '',
      valid_until_gregorian: doc.valid_until_gregorian ?? '',
      valid_until_jalali: doc.valid_until_jalali?.trim?.() ?? '',
      warehouse_id: doc.warehouse_id ?? warehouses[0]?.id ?? '',
      notes: doc.notes ?? '',
      terms: doc.terms ?? '',
      lines: (doc.lines ?? []).map((line: Record<string, any>) => ({
        key: crypto.randomUUID(),
        product_id: line.product_id ?? '',
        description: line.description ?? '',
        unit_fa: line.unit_fa ?? 'عدد',
        quantity: String(line.quantity ?? 1),
        unit_price_rial: String(line.unit_price_rial ?? ''),
        discount_rial: String(line.discount_rial ?? 0),
        is_vat_subject: Boolean(line.is_vat_subject),
        vat_rate_pct: String(line.vat_rate_pct ?? 0),
      })),
    });
    setEditorOpen(true);
    setDetailDocumentId(null);
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => line.key === key ? { ...line, ...patch } : line),
    }));
  };

  const selectProductForLine = (key: string, productId: string) => {
    if (!productId) {
      updateLine(key, {
        product_id: '',
        description: '',
        unit_fa: 'عدد',
        unit_price_rial: '',
        is_vat_subject: true,
        vat_rate_pct: String(settings?.default_vat_rate_pct ?? 10),
      });
      return;
    }
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    updateLine(key, {
      product_id: product.id,
      description: product.name_fa,
      unit_fa: product.unit_fa ?? 'عدد',
      unit_price_rial: product.sale_price_rial == null ? '' : String(product.sale_price_rial),
      is_vat_subject: Boolean(product.is_vat_subject),
      vat_rate_pct: String(product.vat_rate_pct ?? settings?.default_vat_rate_pct ?? 10),
    });
  };

  const buildRpcLines = () => form.lines.map((line) => ({
    product_id: line.product_id || null,
    description: line.description,
    unit_fa: line.unit_fa,
    quantity: Number(line.quantity),
    unit_price_rial: parseRialInteger(line.unit_price_rial),
    discount_rial: parseRialInteger(line.discount_rial),
    is_vat_subject: line.is_vat_subject,
    vat_rate_pct: Number(line.vat_rate_pct || settings?.default_vat_rate_pct || 10),
  }));

  const handleSaveDocument = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !form.party_id || form.lines.length === 0 || isReadOnly) return;
    if (form.lines.some((line) => !line.product_id && !line.description.trim())) {
      setError('شرح هر ردیف کالا یا خدمت الزامی است.');
      return;
    }
    if (form.lines.some((line) => Number(line.quantity) <= 0 || parseRialInteger(line.unit_price_rial) < 0)) {
      setError('تعداد و قیمت ردیف‌ها را بررسی کن.');
      return;
    }
    if (totals.totalRial <= 0) {
      setError('مبلغ نهایی باید بیشتر از صفر باشد.');
      return;
    }
    setSaving(true);
    setError(null);
    const args = {
      p_document_type: form.document_type,
      p_party_id: form.party_id,
      p_issue_date_gregorian: form.issue_date_gregorian,
      p_issue_date_jalali: form.issue_date_jalali,
      p_due_date_gregorian: form.due_date_gregorian || null,
      p_due_date_jalali: form.due_date_jalali || null,
      p_valid_until_gregorian: form.valid_until_gregorian || null,
      p_valid_until_jalali: form.valid_until_jalali || null,
      p_notes: form.notes || null,
      p_terms: form.terms || null,
      p_warehouse_id: form.warehouse_id || null,
      p_lines: buildRpcLines(),
    };
    const result = editingDocument
      ? await supabase.rpc('fn_update_sales_document_draft', { p_document_id: editingDocument.id, ...args })
      : await supabase.rpc('fn_create_sales_document', {
          p_fiscal_year_id: activeFiscalYear.id,
          ...args,
          p_idempotency_key: 'sales-ui-' + crypto.randomUUID(),
        });
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setEditorOpen(false);
    setEditingDocument(null);
    notify(editingDocument ? 'پیش‌نویس با موفقیت به‌روزرسانی شد.' : 'پیش‌نویس فروش با موفقیت ثبت شد.');
    await loadData();
  };

  const runDocumentAction = async (rpcName: string, args: Record<string, unknown>, successText: string) => {
    const supabase = getSupabaseClient();
    if (!supabase || isReadOnly) return;
    setSaving(true);
    setError(null);
    const result = await supabase.rpc(rpcName, args as never);
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    notify(successText);
    setDetailDocumentId(null);
    await loadData();
  };

  const openPayment = (doc: SalesDocument) => {
    const today = getTehranToday();
    setPaymentDocumentId(doc.id);
    setPaymentForm({
      amount_rial: String(doc.balance_rial ?? ''),
      payment_method: 'BANK_TRANSFER',
      bank_tafsil_id: settings?.default_bank_tafsil_id ?? bankParties[0]?.id ?? '',
      reference_no: '',
      payment_date_gregorian: today.gregorian,
      payment_date_jalali: today.jalali,
    });
  };

  const handleRecordPayment = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !paymentDocument || isReadOnly) return;
    const amount = parseRialInteger(paymentForm.amount_rial);
    if (amount <= 0 || amount > asNumber(paymentDocument.balance_rial)) {
      setError('مبلغ دریافت باید مثبت و حداکثر برابر مانده فاکتور باشد.');
      return;
    }
    setSaving(true);
    const result = await supabase.rpc('fn_record_sales_payment', {
      p_invoice_id: paymentDocument.id,
      p_amount_rial: amount,
      p_payment_date_gregorian: paymentForm.payment_date_gregorian,
      p_payment_date_jalali: paymentForm.payment_date_jalali,
      p_payment_method: paymentForm.payment_method,
      p_bank_tafsil_id: paymentForm.bank_tafsil_id || null,
      p_reference_no: paymentForm.reference_no || null,
      p_idempotency_key: 'sales-payment-ui-' + crypto.randomUUID(),
    });
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setPaymentDocumentId(null);
    notify('دریافت وجه ثبت شد؛ سند حسابداری آن در صف پیش‌نویس قرار گرفت.');
    await loadData();
  };

  const handleSaveSettings = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || isReadOnly) return;
    setSaving(true);
    const result = await supabase.from('sales_settings').update({
      seller_name: settingsForm.seller_name.trim(),
      seller_national_id: settingsForm.seller_national_id.trim() || null,
      seller_economic_code: settingsForm.seller_economic_code.trim() || null,
      seller_registration_no: settingsForm.seller_registration_no.trim() || null,
      seller_address: settingsForm.seller_address.trim() || null,
      seller_postal_code: settingsForm.seller_postal_code.trim() || null,
      seller_phone: settingsForm.seller_phone.trim() || null,
      seller_bank_name: settingsForm.seller_bank_name.trim() || null,
      seller_iban: settingsForm.seller_iban.trim() || null,
      default_vat_rate_pct: Number(settingsForm.default_vat_rate_pct),
      updated_at: new Date().toISOString(),
    }).eq('id', true).select('*').single();
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setSettings(result.data as SettingsRow);
    notify('اطلاعات فروشنده و نرخ پیش‌فرض مالیات ذخیره شد.');
    await loadData();
  };

  const openProductEditor = (product: ProductRow) => {
    setProductEditor(product);
    setProductForm({
      sale_price_rial: product.sale_price_rial == null ? '' : String(product.sale_price_rial),
      is_vat_subject: Boolean(product.is_vat_subject),
      vat_rate_pct: product.vat_rate_pct == null ? '' : String(product.vat_rate_pct),
      track_inventory: Boolean(product.track_inventory),
    });
  };

  const handleSaveProduct = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !productEditor || isReadOnly) return;
    const price = productForm.sale_price_rial.trim() ? parseRialInteger(productForm.sale_price_rial) : null;
    const rate = productForm.vat_rate_pct.trim() ? Number(productForm.vat_rate_pct) : null;
    setSaving(true);
    const result = await supabase.rpc('fn_update_product_sales_settings', {
      p_product_id: productEditor.id,
      p_sale_price_rial: price,
      p_is_vat_subject: productForm.is_vat_subject,
      p_vat_rate_pct: rate,
      p_track_inventory: productForm.track_inventory,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setProductEditor(null);
    notify('تنظیمات فروش و انبار کالا ذخیره شد.');
    await loadData();
  };

  const openAdjustment = (product: ProductRow) => {
    setAdjustmentProduct(product);
    setAdjustmentForm({
      warehouse_id: warehouses[0]?.id ?? '',
      quantity_delta: '',
      movement_type: 'OPENING',
      unit_cost_rial: product.standard_cost_rial == null ? '' : String(product.standard_cost_rial),
      note: '',
    });
  };

  const handleAdjustment = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !adjustmentProduct || isReadOnly) return;
    const delta = Number(toEnglishDigits(adjustmentForm.quantity_delta).replace(/[٬,،\s]/g, ''));
    if (!Number.isFinite(delta) || delta === 0 || !adjustmentForm.note.trim()) {
      setError('مقدار موجودی و دلیل ثبت را وارد کن.');
      return;
    }
    setSaving(true);
    const result = await supabase.rpc('fn_adjust_inventory', {
      p_fiscal_year_id: activeFiscalYear.id,
      p_warehouse_id: adjustmentForm.warehouse_id,
      p_product_id: adjustmentProduct.id,
      p_quantity_delta: delta,
      p_movement_type: adjustmentForm.movement_type,
      p_unit_cost_rial: adjustmentForm.unit_cost_rial.trim() ? parseRialInteger(adjustmentForm.unit_cost_rial) : null,
      p_note: adjustmentForm.note.trim(),
    });
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setAdjustmentProduct(null);
    notify('گردش موجودی ثبت شد.');
    await loadData();
  };

  const stockFor = (productId: string, warehouseId?: string) =>
    stockRows.filter((row) => row.product_id === productId && (!warehouseId || row.warehouse_id === warehouseId))
      .reduce((sum, row) => sum + asNumber(row.quantity_on_hand), 0);

  const renderEditor = () => (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6 no-print">
      <div className="my-auto w-full max-w-5xl rounded-2xl border border-white/10 bg-[#142B3D] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-lg font-extrabold text-white">{editingDocument ? 'ویرایش پیش‌نویس' : form.document_type === 'QUOTE' ? 'ساخت پیش‌فاکتور' : 'ساخت فاکتور فروش'}</div>
            <div className={MUTED}>مبالغ به ریال ذخیره می‌شوند؛ اعداد نهایی در سرور محاسبه می‌شوند.</div>
          </div>
          <button type="button" className={SECONDARY} onClick={() => setEditorOpen(false)}><X className="h-4 w-4" /> بستن</button>
        </div>
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_290px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-slate-300">
                مشتری
                <select className={SELECT} value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })}>
                  <option value="">انتخاب مشتری...</option>
                  {parties.map((party) => <option key={party.id} value={party.id}>{party.full_name} — {party.tafsil_code}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 text-xs text-slate-300">
                تاریخ سند
                <input type="date" className={INPUT} value={form.issue_date_gregorian} onChange={(e) => setForm({
                  ...form, issue_date_gregorian: e.target.value, issue_date_jalali: gregorianToJalali(e.target.value),
                })} />
                <span className={MUTED}>شمسی: {toPersianDigits(form.issue_date_jalali)}</span>
              </label>
              {form.document_type === 'INVOICE' ? (
                <label className="space-y-1.5 text-xs text-slate-300">
                  سررسید پرداخت
                  <input type="date" className={INPUT} value={form.due_date_gregorian} onChange={(e) => setForm({
                    ...form, due_date_gregorian: e.target.value, due_date_jalali: gregorianToJalali(e.target.value),
                  })} />
                  <span className={MUTED}>شمسی: {toPersianDigits(form.due_date_jalali || '—')}</span>
                </label>
              ) : (
                <label className="space-y-1.5 text-xs text-slate-300">
                  اعتبار پیش‌فاکتور تا
                  <input type="date" className={INPUT} value={form.valid_until_gregorian} onChange={(e) => setForm({
                    ...form, valid_until_gregorian: e.target.value, valid_until_jalali: gregorianToJalali(e.target.value),
                  })} />
                  <span className={MUTED}>شمسی: {toPersianDigits(form.valid_until_jalali || '—')}</span>
                </label>
              )}
              <label className="space-y-1.5 text-xs text-slate-300">
                انبار خروج کالا
                <select className={SELECT} value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
                  <option value="">بدون انبار / خدمات</option>
                  {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name_fa}</option>)}
                </select>
              </label>
            </div>

            <div className="overflow-hidden rounded-xl border border-white/10">
              <div className="flex items-center justify-between bg-white/[0.04] px-4 py-3">
                <div className="font-bold text-white">اقلام سند</div>
                <button type="button" className={SECONDARY} onClick={() => setForm({ ...form, lines: [...form.lines, newLine(settings)] })}><Plus className="h-4 w-4" /> افزودن ردیف</button>
              </div>
              <div className="space-y-3 p-3">
                {form.lines.map((line, index) => {
                  const product = products.find((item) => item.id === line.product_id);
                  let lineTotal = 0;
                  try {
                    lineTotal = calculateSalesTotals([{
                      quantity: line.quantity,
                      unitPriceRial: line.unit_price_rial || '0',
                      discountRial: line.discount_rial || '0',
                      vatRatePct: line.vat_rate_pct || '0',
                      isVatSubject: line.is_vat_subject,
                    }]).totalRial;
                  } catch { lineTotal = 0; }
                  return (
                    <div key={line.key} className="rounded-xl border border-white/10 bg-[#0D2030] p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-bold text-[#FFB36F]">ردیف {toPersianDigits(index + 1)}</span>
                        <button type="button" disabled={form.lines.length <= 1} onClick={() => setForm({
                          ...form, lines: form.lines.filter((item) => item.key !== line.key),
                        })} className="rounded-lg p-2 text-slate-400 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-30" aria-label="حذف ردیف">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="space-y-1 text-xs text-slate-400">
                          کالا / خدمت ثبت‌شده
                          <select className={SELECT} value={line.product_id} onChange={(e) => selectProductForLine(line.key, e.target.value)}>
                            <option value="">شرح آزاد (کالا یا خدمت)</option>
                            {products.map((item) => <option key={item.id} value={item.id}>{item.product_code} — {item.name_fa}</option>)}
                          </select>
                        </label>
                        <label className="space-y-1 text-xs text-slate-400">
                          شرح ردیف
                          <input className={INPUT} value={line.description} disabled={Boolean(product)} onChange={(e) => updateLine(line.key, { description: e.target.value })} placeholder="شرح کالا یا خدمت" />
                        </label>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className="space-y-1 text-xs text-slate-400">تعداد
                          <input className={INPUT + ' num-ltr'} type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                        </label>
                        <label className="space-y-1 text-xs text-slate-400">قیمت واحد (ریال)
                          <input className={INPUT + ' num-ltr'} inputMode="numeric" value={line.unit_price_rial} onChange={(e) => updateLine(line.key, { unit_price_rial: toEnglishDigits(e.target.value).replace(/[^\d]/g, '') })} placeholder="مثلاً ۱۰۰۰۰۰۰" />
                        </label>
                        <label className="space-y-1 text-xs text-slate-400">تخفیف ردیف (ریال)
                          <input className={INPUT + ' num-ltr'} inputMode="numeric" value={line.discount_rial} onChange={(e) => updateLine(line.key, { discount_rial: toEnglishDigits(e.target.value).replace(/[^\d]/g, '') })} />
                        </label>
                        <label className="space-y-1 text-xs text-slate-400">نرخ ارزش افزوده %
                          <input className={INPUT + ' num-ltr'} type="number" min="0" max="100" step="0.01" disabled={Boolean(product) || !line.is_vat_subject} value={line.is_vat_subject ? line.vat_rate_pct : '0'} onChange={(e) => updateLine(line.key, { vat_rate_pct: e.target.value })} />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={line.is_vat_subject} disabled={Boolean(product)} onChange={(e) => updateLine(line.key, { is_vat_subject: e.target.checked })} />
                          مشمول ارزش افزوده
                          {product && <span className="text-slate-500">(از اطلاعات کالا)</span>}
                        </label>
                        <div className="text-sm font-bold text-white">مبلغ ردیف: <span className="num-ltr text-[#FFB36F]">{formatMoney(lineTotal, currencyUnit)}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-slate-300">یادداشت
                <textarea className={INPUT + ' min-h-[82px] resize-y'} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="توضیحات تکمیلی برای مشتری..." />
              </label>
              <label className="space-y-1.5 text-xs text-slate-300">شرایط فروش
                <textarea className={INPUT + ' min-h-[82px] resize-y'} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="شرایط پرداخت، تحویل و گارانتی..." />
              </label>
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-[#0D2030] p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white"><ShoppingCart className="h-4 w-4 text-[#FF9B45]" /> خلاصه مالی</div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-slate-400"><span>جمع ناخالص</span><span className="num-ltr">{formatMoney(totals.subtotalRial, currencyUnit)}</span></div>
                <div className="flex justify-between text-slate-400"><span>تخفیف</span><span className="num-ltr">{formatMoney(totals.discountRial, currencyUnit)}</span></div>
                <div className="flex justify-between text-slate-400"><span>ارزش افزوده</span><span className="num-ltr">{formatMoney(totals.vatRial, currencyUnit)}</span></div>
                <div className="border-t border-white/10 pt-3">
                  <div className="text-xs text-slate-400">مبلغ نهایی</div>
                  <div className="mt-1 text-2xl font-black text-[#FFB36F] num-ltr">{formatMoney(totals.totalRial, currencyUnit)}</div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-xs leading-6 text-amber-100/80">
              <AlertCircle className="mb-1 inline h-4 w-4" /> این سند پیش‌نویس تجاری است. صدور فاکتور، ساخت پیش‌نویس سند حسابداری و کنترل موجودی در مرحله بعدی و با اقدام انسانی انجام می‌شود.
            </div>
            <button type="button" disabled={saving || isReadOnly || !form.party_id || totals.totalRial <= 0} onClick={() => void handleSaveDocument()} className={PRIMARY + ' w-full'}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingDocument ? 'ذخیره تغییرات' : 'ثبت پیش‌نویس'}
            </button>
            <button type="button" onClick={() => setEditorOpen(false)} className={SECONDARY + ' w-full'}>انصراف</button>
          </aside>
        </div>
      </div>
    </div>
  );

  const renderDocuments = () => (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#19364B] p-4">
          <div className={MUTED}>فروش صادرشده در سال مالی</div>
          <div className="mt-2 text-xl font-black text-white num-ltr">{formatMoney(issuedSales, currencyUnit)}</div>
          <div className="mt-1 text-xs text-slate-500">{toPersianDigits(invoices.length)} فاکتور صادرشده</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#19364B] p-4">
          <div className={MUTED}>مانده مطالبات</div>
          <div className="mt-2 text-xl font-black text-amber-300 num-ltr">{formatMoney(outstanding, currencyUnit)}</div>
          <div className="mt-1 text-xs text-slate-500">پس از ثبت دریافت‌ها</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#19364B] p-4">
          <div className={MUTED}>پیش‌فاکتورهای باز</div>
          <div className="mt-2 text-xl font-black text-sky-300 num-ltr">{toPersianDigits(pendingQuotes)}</div>
          <div className="mt-1 text-xs text-slate-500">نیازمند پیگیری یا تأیید مشتری</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">اسناد فروش</h2>
          <p className={MUTED}>پیش‌فاکتور، فاکتور، وضعیت وصول و ارتباط با حسابداری</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={isReadOnly} className={SECONDARY} onClick={() => startCreate('QUOTE')}><FilePlus2 className="h-4 w-4" /> پیش‌فاکتور جدید</button>
          <button type="button" disabled={isReadOnly} className={PRIMARY} onClick={() => startCreate('INVOICE')}><Plus className="h-4 w-4" /> فاکتور جدید</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#19364B] p-3">
        <div className="relative min-w-[190px] flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className={INPUT + ' pr-9'} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو بر اساس شماره یا مشتری..." />
        </div>
        {(['ALL', 'QUOTE', 'INVOICE'] as const).map((value) => (
          <button type="button" key={value} onClick={() => setFilterType(value)} className={BUTTON + ' ' + (filterType === value ? 'bg-[#FF9B45] text-[#172B3B]' : 'border border-white/10 text-slate-300 hover:bg-white/5')}>
            {value === 'ALL' ? 'همه' : value === 'QUOTE' ? 'پیش‌فاکتورها' : 'فاکتورها'}
          </button>
        ))}
        <button type="button" onClick={() => void loadData()} className={SECONDARY} aria-label="بارگذاری مجدد"><RefreshCw className="h-4 w-4" /></button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#19364B]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-right text-sm">
            <thead className="bg-[#0D2030] text-xs text-slate-400">
              <tr>
                <th className="px-4 py-3">شماره</th>
                <th className="px-4 py-3">نوع سند / مشتری</th>
                <th className="px-4 py-3">تاریخ</th>
                <th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3">مبلغ نهایی</th>
                <th className="px-4 py-3">مانده</th>
                <th className="px-4 py-3">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filteredDocuments.map((doc) => (
                <tr key={doc.id} className="hover:bg-white/[0.025]">
                  <td className="px-4 py-3 font-bold text-[#FFB36F] num-ltr">{docNumber(doc, activeFiscalYear.code)}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{doc.document_type === 'QUOTE' ? 'پیش‌فاکتور' : 'فاکتور فروش'}</div>
                    <div className="mt-1 text-xs text-slate-400">{doc.party_name_snapshot}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300"><JalaliDate value={doc.issue_date_jalali?.trim?.() ?? doc.issue_date_jalali} /></td>
                  <td className="px-4 py-3"><span className={'inline-flex rounded-lg border px-2 py-1 text-[11px] font-semibold ' + statusClass(doc.status)}>{documentStatusLabel(doc.status)}</span></td>
                  <td className="px-4 py-3 font-semibold text-white num-ltr">{formatMoney(doc.total_rial, currencyUnit)}</td>
                  <td className="px-4 py-3 text-slate-300 num-ltr">{formatMoney(doc.balance_rial, currencyUnit)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10" onClick={() => setDetailDocumentId(doc.id)}>جزئیات</button>
                      <button type="button" className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10" onClick={() => setPrintDocument(doc)} aria-label="چاپ"><Printer className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredDocuments.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">در این سال مالی هنوز سند فروشی ثبت نشده است.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[11px] leading-6 text-slate-500">فاکتورهای این بخش، اسناد تجاری داخلی هستند و با صورتحساب‌های واردشده از سامانه مؤدیان تفاوت دارند. ارسال مستقیم به سامانه مؤدیان در این مرحله فعال نیست.</div>
    </div>
  );

  const renderInventory = () => (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">کالا و موجودی انبار</h2>
          <p className={MUTED}>قیمت فروش، وضعیت مالیاتی و گردش موجودی کالاها</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#19364B] px-3 py-2 text-xs text-slate-300">{toPersianDigits(products.filter((p) => p.track_inventory).length)} کالای انبارگردانی‌شونده</div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#19364B]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-right text-sm">
            <thead className="bg-[#0D2030] text-xs text-slate-400">
              <tr><th className="px-4 py-3">کد / کالا</th><th className="px-4 py-3">قیمت فروش</th><th className="px-4 py-3">مالیات</th><th className="px-4 py-3">موجودی انبار اصلی</th><th className="px-4 py-3">انبارگردانی</th><th className="px-4 py-3">عملیات</th></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {products.map((product) => {
                const stock = stockFor(product.id, warehouses[0]?.id);
                return (
                  <tr key={product.id} className="hover:bg-white/[0.025]">
                    <td className="px-4 py-3"><div className="font-semibold text-white">{product.name_fa}</div><div className="mt-1 text-[11px] text-slate-500 num-ltr">{product.product_code} · {product.unit_fa}</div></td>
                    <td className="px-4 py-3 text-slate-200 num-ltr">{product.sale_price_rial == null ? 'ثبت نشده' : formatMoney(product.sale_price_rial, currencyUnit)}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">{product.is_vat_subject ? toPersianDigits(product.vat_rate_pct ?? settings?.default_vat_rate_pct ?? 10) + '٪' : 'معاف'}</td>
                    <td className="px-4 py-3 font-bold text-white num-ltr">{product.track_inventory ? toPersianDigits(stock) + ' ' + (product.unit_fa ?? '') : 'غیرفعال'}</td>
                    <td className="px-4 py-3"><span className={'rounded-lg border px-2 py-1 text-[11px] ' + (product.track_inventory ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-slate-400')}>{product.track_inventory ? 'فعال' : 'غیرفعال'}</span></td>
                    <td className="px-4 py-3"><div className="flex gap-1.5">
                      <button type="button" disabled={isReadOnly} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10" onClick={() => openProductEditor(product)}>تنظیم کالا</button>
                      <button type="button" disabled={isReadOnly || !product.track_inventory} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30" onClick={() => openAdjustment(product)}>ثبت موجودی</button>
                    </div></td>
                  </tr>
                );
              })}
              {products.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">کالای فعالی ثبت نشده است.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-4 text-xs leading-6 text-amber-100/80">
        <AlertCircle className="mb-1 inline h-4 w-4" /> برای کالاهایی که انبارگردانی آن‌ها را فعال می‌کنی، قبل از صدور فاکتور باید موجودی اول دوره ثبت شود. سیستم موجودی منفی را نمی‌پذیرد.
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-extrabold text-white">تنظیمات فاکتور فروش</h2>
        <p className={MUTED}>اطلاعات فروشنده در زمان ساخت هر سند ذخیره می‌شود تا فاکتورهای قدیمی تغییر نکنند.</p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_330px]">
        <div className="rounded-2xl border border-white/10 bg-[#19364B] p-5">
          <div className="mb-4 font-bold text-white">مشخصات فروشنده</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['seller_name', 'نام حقوقی فروشنده'],
              ['seller_national_id', 'شناسه ملی'],
              ['seller_economic_code', 'کد اقتصادی'],
              ['seller_registration_no', 'شماره ثبت'],
              ['seller_phone', 'تلفن'],
              ['seller_postal_code', 'کد پستی'],
              ['seller_bank_name', 'نام بانک'],
              ['seller_iban', 'شماره شبا'],
            ] as Array<[keyof typeof settingsForm, string]>).map(([key, label]) => (
              <label key={key} className="space-y-1.5 text-xs text-slate-300">{label}
                <input className={INPUT} value={settingsForm[key]} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })} />
              </label>
            ))}
            <label className="space-y-1.5 text-xs text-slate-300 sm:col-span-2">نشانی
              <textarea className={INPUT + ' min-h-[76px]'} value={settingsForm.seller_address} onChange={(e) => setSettingsForm({ ...settingsForm, seller_address: e.target.value })} />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" disabled={saving || isReadOnly} onClick={() => void handleSaveSettings()} className={PRIMARY}><Save className="h-4 w-4" /> ذخیره اطلاعات فروشنده</button>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-[#19364B] p-5">
            <div className="mb-3 font-bold text-white">مالیات و حسابداری</div>
            <label className="block space-y-1.5 text-xs text-slate-300">نرخ پیش‌فرض ارزش افزوده (%)
              <input className={INPUT + ' num-ltr'} type="number" min="0" max="100" step="0.01" value={settingsForm.default_vat_rate_pct} onChange={(e) => setSettingsForm({ ...settingsForm, default_vat_rate_pct: e.target.value })} />
            </label>
            <div className="mt-4 space-y-2 text-xs text-slate-400">
              <div className="flex justify-between"><span>دریافتنی مشتری</span><b className="num-ltr text-white">1103</b></div>
              <div className="flex justify-between"><span>درآمد فروش</span><b className="num-ltr text-white">7101</b></div>
              <div className="flex justify-between"><span>ارزش افزوده پرداختنی</span><b className="num-ltr text-white">2107</b></div>
              <div className="flex justify-between"><span>نقد و بانک</span><b className="num-ltr text-white">1100</b></div>
            </div>
            <div className="mt-4 rounded-xl bg-[#0D2030] p-3 text-[11px] leading-6 text-slate-400">نرخ پیش‌فرض فقط برای ردیف‌های مشمول استفاده می‌شود. نرخ و مبلغ محاسبه‌شده در هر ردیف سند ذخیره می‌شود؛ تغییر بعدی تنظیمات، اسناد قبلی را تغییر نمی‌دهد.</div>
            <div className="mt-3 flex justify-end">
              <button type="button" disabled={saving || isReadOnly} onClick={() => void handleSaveSettings()} className={SECONDARY}><Save className="h-4 w-4" /> ذخیره نرخ و تنظیمات</button>
            </div>
          </div>
          <div className="rounded-2xl border border-sky-300/15 bg-sky-300/[0.05] p-4 text-xs leading-6 text-sky-100/80">
            این ماژول فاکتور تجاری داخلی تولید می‌کند. اتصال و ارسال صورتحساب الکترونیکی به سامانه مؤدیان هنوز انجام نشده و این فاکتور جایگزین آن نیست.
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="sales-app-shell space-y-5 px-4 py-5 lg:px-7 lg:py-7" dir="rtl">
      <style>{'@media print { body * { visibility: hidden !important; } .sales-print, .sales-print * { visibility: visible !important; } .sales-print { display: block !important; position: absolute !important; inset: 0 !important; width: 100% !important; margin: 0 !important; padding: 12mm !important; background: #fff !important; color: #111 !important; direction: rtl !important; font-family: Tahoma, Arial, sans-serif !important; } .sales-print table { width: 100% !important; border-collapse: collapse !important; } .sales-print th, .sales-print td { border: 1px solid #bbb !important; padding: 8px !important; color: #111 !important; } .sales-print .muted { color: #555 !important; } @page { size: A4; margin: 0; } } .sales-print { display: none; }'}</style>

      <div className="no-print flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold text-[#FFB36F]"><ShoppingCart className="h-4 w-4" /> چرخه فروش و فاکتور</div>
          <h1 className="text-2xl font-black text-white">فروش و صورتحساب</h1>
          <p className="mt-1 text-sm text-slate-400">سال مالی {toPersianDigits(activeFiscalYear.code)} · پیش‌فاکتور، فاکتور، وصول و انبار</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadData()} className={SECONDARY}><RefreshCw className="h-4 w-4" /> بروزرسانی</button>
          <span className={'rounded-xl border px-3 py-2 text-xs ' + (isReadOnly ? 'border-amber-300/20 bg-amber-300/10 text-amber-200' : 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200')}>{isReadOnly ? 'سال مالی بسته — فقط مشاهده' : 'سال مالی باز'}</span>
        </div>
      </div>

      {error && <div className="no-print flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span><button type="button" className="mr-auto" onClick={() => setError(null)}><X className="h-4 w-4" /></button></div>}
      {message && <div className="no-print flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200"><Check className="h-4 w-4" />{message}<button type="button" className="mr-auto" onClick={() => setMessage(null)}><X className="h-4 w-4" /></button></div>}

      <div className="no-print flex flex-wrap gap-2 border-b border-white/10 pb-3">
        <button type="button" onClick={() => setTab('documents')} className={BUTTON + ' ' + (tab === 'documents' ? 'bg-[#FF9B45] text-[#172B3B]' : 'border border-white/10 text-slate-300 hover:bg-white/5')}><FileText className="h-4 w-4" /> اسناد فروش</button>
        <button type="button" onClick={() => setTab('inventory')} className={BUTTON + ' ' + (tab === 'inventory' ? 'bg-[#FF9B45] text-[#172B3B]' : 'border border-white/10 text-slate-300 hover:bg-white/5')}><Package className="h-4 w-4" /> کالا و انبار</button>
        <button type="button" onClick={() => setTab('settings')} className={BUTTON + ' ' + (tab === 'settings' ? 'bg-[#FF9B45] text-[#172B3B]' : 'border border-white/10 text-slate-300 hover:bg-white/5')}><Settings2 className="h-4 w-4" /> تنظیمات فاکتور</button>
      </div>

      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center gap-3 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-[#FF9B45]" /> در حال دریافت اطلاعات فروش...</div>
      ) : (
        <div className="no-print">
          {tab === 'documents' && renderDocuments()}
          {tab === 'inventory' && renderInventory()}
          {tab === 'settings' && renderSettings()}
        </div>
      )}

      {editorOpen && !loading && renderEditor()}

      {selectedDocument && (
        <div className="no-print fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6">
          <div className="my-auto w-full max-w-4xl rounded-2xl border border-white/10 bg-[#142B3D] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div><div className="font-extrabold text-white">{selectedDocument.document_type === 'QUOTE' ? 'پیش‌فاکتور' : 'فاکتور فروش'} {docNumber(selectedDocument, activeFiscalYear.code)}</div><div className="mt-1 text-xs text-slate-400">{selectedDocument.party_name_snapshot}</div></div>
              <button type="button" className={SECONDARY} onClick={() => setDetailDocumentId(null)}><X className="h-4 w-4" /> بستن</button>
            </div>
            <div className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <span className={'rounded-lg border px-2.5 py-1 text-xs ' + statusClass(selectedDocument.status)}>{documentStatusLabel(selectedDocument.status)}</span>
                <span className="text-xs text-slate-400">تاریخ: <JalaliDate value={selectedDocument.issue_date_jalali?.trim?.() ?? selectedDocument.issue_date_jalali} /></span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[620px] text-right text-xs">
                  <thead className="bg-[#0D2030] text-slate-400"><tr><th className="p-3">شرح</th><th className="p-3">تعداد</th><th className="p-3">قیمت واحد</th><th className="p-3">مالیات</th><th className="p-3">جمع ردیف</th></tr></thead>
                  <tbody className="divide-y divide-white/[0.06]">{(selectedDocument.lines ?? []).map((line: Record<string, any>) => (
                    <tr key={line.id}><td className="p-3 text-white">{line.description}</td><td className="p-3 num-ltr">{toPersianDigits(line.quantity)} {line.unit_fa}</td><td className="p-3 num-ltr">{formatMoney(line.unit_price_rial, currencyUnit)}</td><td className="p-3 num-ltr">{formatMoney(line.vat_amount_rial, currencyUnit)}</td><td className="p-3 font-bold text-white num-ltr">{formatMoney(line.line_total_rial, currencyUnit)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-[#0D2030] p-3 text-xs text-slate-400">جمع قبل از تخفیف<div className="mt-1 font-bold text-white num-ltr">{formatMoney(selectedDocument.subtotal_rial, currencyUnit)}</div></div>
                <div className="rounded-xl bg-[#0D2030] p-3 text-xs text-slate-400">مالیات و عوارض<div className="mt-1 font-bold text-white num-ltr">{formatMoney(selectedDocument.tax_rial, currencyUnit)}</div></div>
                <div className="rounded-xl bg-[#0D2030] p-3 text-xs text-slate-400">مبلغ نهایی<div className="mt-1 text-lg font-black text-[#FFB36F] num-ltr">{formatMoney(selectedDocument.total_rial, currencyUnit)}</div></div>
              </div>
              {selectedDocument.voucher_id && <div className="mt-3 rounded-lg bg-sky-400/10 p-3 text-xs text-sky-200">سند حسابداری مرتبط: {selectedDocument.voucher_id} — پیش‌نویس و منتظر قطعی‌سازی انسانی</div>}
              {(selectedDocument.payments ?? []).length > 0 && <div className="mt-4 space-y-2"><div className="text-xs font-bold text-white">دریافت‌های ثبت‌شده</div>{selectedDocument.payments.map((payment: Record<string, any>) => <div key={payment.id} className="flex justify-between rounded-lg bg-white/[0.04] p-2 text-xs"><span>{toPersianDigits(payment.payment_date_jalali?.trim?.() ?? payment.payment_date_jalali)} · {payment.payment_method}</span><b className="num-ltr">{formatMoney(payment.amount_rial, currencyUnit)}</b></div>)}</div>}
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className={SECONDARY} onClick={() => setPrintDocument(selectedDocument)}><Printer className="h-4 w-4" /> چاپ / PDF</button>
                {selectedDocument.status === 'DRAFT' && <button type="button" disabled={isReadOnly || saving} className={SECONDARY} onClick={() => startEdit(selectedDocument)}>ویرایش پیش‌نویس</button>}
                {selectedDocument.document_type === 'QUOTE' && selectedDocument.status === 'DRAFT' && <button type="button" disabled={isReadOnly || saving} className={PRIMARY} onClick={() => void runDocumentAction('fn_send_sales_quote', { p_quote_id: selectedDocument.id }, 'پیش‌فاکتور برای ارسال آماده شد.')}>علامت‌گذاری ارسال</button>}
                {selectedDocument.document_type === 'QUOTE' && selectedDocument.status === 'SENT' && <button type="button" disabled={isReadOnly || saving} className={PRIMARY} onClick={() => void runDocumentAction('fn_accept_sales_quote', { p_quote_id: selectedDocument.id }, 'تأیید مشتری ثبت شد.')}>تأیید مشتری</button>}
                {selectedDocument.document_type === 'QUOTE' && selectedDocument.status === 'ACCEPTED' && <button type="button" disabled={isReadOnly || saving} className={PRIMARY} onClick={() => {
                  const today = getTehranToday();
                  void runDocumentAction('fn_convert_sales_quote_to_invoice', {
                    p_quote_id: selectedDocument.id,
                    p_issue_date_gregorian: today.gregorian,
                    p_issue_date_jalali: today.jalali,
                    p_due_date_gregorian: addGregorianDays(today.gregorian, 30),
                    p_due_date_jalali: gregorianToJalali(addGregorianDays(today.gregorian, 30)),
                    p_idempotency_key: 'quote-convert-' + crypto.randomUUID(),
                  }, 'پیش‌فاکتور به فاکتور فروش تبدیل شد.');
                }}>تبدیل به فاکتور</button>}
                {selectedDocument.document_type === 'INVOICE' && selectedDocument.status === 'DRAFT' && <button type="button" disabled={isReadOnly || saving} className={PRIMARY} onClick={() => void runDocumentAction('fn_issue_sales_invoice', { p_invoice_id: selectedDocument.id }, 'فاکتور صادر شد و سند حسابداری در وضعیت پیش‌نویس ساخته شد.')}>صدور فاکتور</button>}
                {selectedDocument.document_type === 'INVOICE' && ['ISSUED', 'PARTIALLY_PAID'].includes(selectedDocument.status) && <button type="button" disabled={isReadOnly || saving} className={PRIMARY} onClick={() => { setDetailDocumentId(null); openPayment(selectedDocument); }}><Wallet className="h-4 w-4" /> ثبت دریافت</button>}
                {selectedDocument.status === 'DRAFT' && <button type="button" disabled={isReadOnly || saving} className="rounded-xl border border-rose-400/20 px-3 py-2 text-sm text-rose-200 hover:bg-rose-400/10" onClick={() => void runDocumentAction('fn_cancel_sales_draft', { p_document_id: selectedDocument.id }, 'پیش‌نویس لغو شد.')}>لغو پیش‌نویس</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {paymentDocument && (
        <div className="no-print fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#142B3D] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><div><div className="font-bold text-white">ثبت دریافت وجه</div><div className="mt-1 text-xs text-slate-400">{docNumber(paymentDocument, activeFiscalYear.code)} · مانده {formatMoney(paymentDocument.balance_rial, currencyUnit)}</div></div><button type="button" className={SECONDARY} onClick={() => setPaymentDocumentId(null)}><X className="h-4 w-4" /></button></div>
            <div className="space-y-3">
              <label className="block space-y-1.5 text-xs text-slate-300">مبلغ دریافت (ریال)<input className={INPUT + ' num-ltr'} inputMode="numeric" value={paymentForm.amount_rial} onChange={(e) => setPaymentForm({ ...paymentForm, amount_rial: toEnglishDigits(e.target.value).replace(/[^\d]/g, '') })} /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs text-slate-300">روش دریافت<select className={SELECT} value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}><option value="BANK_TRANSFER">واریز بانکی</option><option value="CASH">نقدی</option><option value="CHEQUE">چک</option><option value="OTHER">سایر</option></select></label>
                <label className="space-y-1.5 text-xs text-slate-300">صندوق / حساب بانکی<select className={SELECT} value={paymentForm.bank_tafsil_id} onChange={(e) => setPaymentForm({ ...paymentForm, bank_tafsil_id: e.target.value })}>{bankParties.map((bank) => <option key={bank.id} value={bank.id}>{bank.full_name} — {bank.tafsil_code}</option>)}</select></label>
              </div>
              <label className="block space-y-1.5 text-xs text-slate-300">تاریخ دریافت<input type="date" className={INPUT} value={paymentForm.payment_date_gregorian} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date_gregorian: e.target.value, payment_date_jalali: gregorianToJalali(e.target.value) })} /><span className={MUTED}>شمسی: {toPersianDigits(paymentForm.payment_date_jalali)}</span></label>
              <label className="block space-y-1.5 text-xs text-slate-300">شماره پیگیری / توضیح<input className={INPUT} value={paymentForm.reference_no} onChange={(e) => setPaymentForm({ ...paymentForm, reference_no: e.target.value })} /></label>
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setPaymentDocumentId(null)}>انصراف</button><button type="button" disabled={saving || !paymentForm.bank_tafsil_id} className={PRIMARY} onClick={() => void handleRecordPayment()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} ثبت دریافت</button></div>
          </div>
        </div>
      )}

      {productEditor && (
        <div className="no-print fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#142B3D] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><div><div className="font-bold text-white">تنظیم کالا</div><div className="mt-1 text-xs text-slate-400">{productEditor.name_fa}</div></div><button type="button" className={SECONDARY} onClick={() => setProductEditor(null)}><X className="h-4 w-4" /></button></div>
            <div className="space-y-3">
              <label className="block space-y-1.5 text-xs text-slate-300">قیمت فروش واحد (ریال)<input className={INPUT + ' num-ltr'} inputMode="numeric" value={productForm.sale_price_rial} onChange={(e) => setProductForm({ ...productForm, sale_price_rial: toEnglishDigits(e.target.value).replace(/[^\d]/g, '') })} /></label>
              <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={productForm.is_vat_subject} onChange={(e) => setProductForm({ ...productForm, is_vat_subject: e.target.checked })} /> مشمول ارزش افزوده</label>
              <label className="block space-y-1.5 text-xs text-slate-300">نرخ اختصاصی (خالی = نرخ پیش‌فرض)<input className={INPUT + ' num-ltr'} type="number" min="0" max="100" step="0.01" value={productForm.vat_rate_pct} onChange={(e) => setProductForm({ ...productForm, vat_rate_pct: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={productForm.track_inventory} onChange={(e) => setProductForm({ ...productForm, track_inventory: e.target.checked })} /> انبارگردانی این کالا فعال باشد</label>
              {productForm.track_inventory && !productEditor.track_inventory && <div className="rounded-lg bg-amber-300/10 p-2 text-xs text-amber-100">پس از فعال‌سازی، موجودی اول دوره را در بخش کالا و انبار ثبت کن.</div>}
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setProductEditor(null)}>انصراف</button><button type="button" disabled={saving} className={PRIMARY} onClick={() => void handleSaveProduct()}><Save className="h-4 w-4" /> ذخیره کالا</button></div>
          </div>
        </div>
      )}

      {adjustmentProduct && (
        <div className="no-print fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#142B3D] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><div><div className="font-bold text-white">ثبت گردش موجودی</div><div className="mt-1 text-xs text-slate-400">{adjustmentProduct.name_fa}</div></div><button type="button" className={SECONDARY} onClick={() => setAdjustmentProduct(null)}><X className="h-4 w-4" /></button></div>
            <div className="space-y-3">
              <label className="block space-y-1.5 text-xs text-slate-300">انبار<select className={SELECT} value={adjustmentForm.warehouse_id} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, warehouse_id: e.target.value })}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name_fa}</option>)}</select></label>
              <label className="block space-y-1.5 text-xs text-slate-300">نوع گردش<select className={SELECT} value={adjustmentForm.movement_type} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, movement_type: e.target.value })}><option value="OPENING">موجودی اول دوره</option><option value="ADJUSTMENT">اصلاح موجودی</option></select></label>
              <label className="block space-y-1.5 text-xs text-slate-300">تغییر مقدار (+ ورود / − خروج)<input className={INPUT + ' num-ltr'} type="number" step="0.001" value={adjustmentForm.quantity_delta} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, quantity_delta: e.target.value })} /></label>
              <label className="block space-y-1.5 text-xs text-slate-300">بهای واحد (ریال، اختیاری)<input className={INPUT + ' num-ltr'} inputMode="numeric" value={adjustmentForm.unit_cost_rial} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, unit_cost_rial: toEnglishDigits(e.target.value).replace(/[^\d]/g, '') })} /></label>
              <label className="block space-y-1.5 text-xs text-slate-300">دلیل ثبت / شماره سند<input className={INPUT} value={adjustmentForm.note} onChange={(e) => setAdjustmentForm({ ...adjustmentForm, note: e.target.value })} placeholder="مثلاً موجودی اول دوره طبق شمارش انبار" /></label>
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setAdjustmentProduct(null)}>انصراف</button><button type="button" disabled={saving || !adjustmentForm.warehouse_id} className={PRIMARY} onClick={() => void handleAdjustment()}><Save className="h-4 w-4" /> ثبت گردش</button></div>
          </div>
        </div>
      )}

      {printDocument && (
        <div className="sales-print" dir="rtl">
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #222', paddingBottom: '16px', marginBottom: '18px' }}>
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>{printDocument.document_type === 'QUOTE' ? 'پیش‌فاکتور فروش' : 'فاکتور فروش'}</h1>
              <p className="muted" style={{ marginTop: '8px', fontSize: '11px' }}>شماره: {formatSalesDocumentNumber(printDocument.document_type, activeFiscalYear.code, Number(printDocument.document_no))}</p>
            </div>
            <div style={{ textAlign: 'left', fontSize: '11px', lineHeight: 1.9 }}>
              <b>{printDocument.seller_name_snapshot}</b><br />
              شناسه ملی: {printDocument.seller_national_id_snapshot || '—'}<br />
              کد اقتصادی: {printDocument.seller_economic_code_snapshot || '—'}<br />
              شماره ثبت: {printDocument.seller_registration_no_snapshot || '—'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '18px', fontSize: '11px', lineHeight: 1.9 }}>
            <div><b>مشخصات خریدار</b><br />{printDocument.party_name_snapshot}<br />شناسه ملی: {printDocument.party_national_id_snapshot || '—'}<br />کد اقتصادی: {printDocument.party_economic_code_snapshot || '—'}<br />نشانی: {printDocument.party_address_snapshot || '—'}<br />تلفن: {printDocument.party_phone_snapshot || '—'}</div>
            <div><b>مشخصات سند</b><br />تاریخ: {printDocument.issue_date_jalali?.trim?.() ?? printDocument.issue_date_jalali}<br />سررسید: {printDocument.due_date_jalali?.trim?.() ?? printDocument.due_date_jalali ?? '—'}<br />اعتبار پیش‌فاکتور: {printDocument.valid_until_jalali?.trim?.() ?? printDocument.valid_until_jalali ?? '—'}<br />وضعیت: {documentStatusLabel(printDocument.status)}</div>
          </div>
          <table style={{ fontSize: '10px', marginBottom: '18px' }}>
            <thead><tr><th>ردیف</th><th>شرح کالا / خدمت</th><th>تعداد</th><th>قیمت واحد (ریال)</th><th>تخفیف</th><th>مالیات</th><th>جمع ردیف</th></tr></thead>
            <tbody>{(printDocument.lines ?? []).map((line: Record<string, any>) => <tr key={line.id}><td>{toPersianDigits(line.line_no)}</td><td>{line.description}</td><td>{toPersianDigits(line.quantity)} {line.unit_fa}</td><td>{toPersianDigits(line.unit_price_rial)}</td><td>{toPersianDigits(line.discount_rial)}</td><td>{toPersianDigits(line.vat_amount_rial)}</td><td>{toPersianDigits(line.line_total_rial)}</td></tr>)}</tbody>
          </table>
          <div style={{ width: '330px', marginRight: 'auto', fontSize: '11px', lineHeight: 2 }}>
            <div>جمع ناخالص: {toPersianDigits(printDocument.subtotal_rial)} ریال</div>
            <div>تخفیف: {toPersianDigits(printDocument.discount_rial)} ریال</div>
            <div>مالیات و عوارض: {toPersianDigits(printDocument.tax_rial)} ریال</div>
            <div style={{ borderTop: '2px solid #222', marginTop: '5px', paddingTop: '5px', fontSize: '15px', fontWeight: 800 }}>مبلغ قابل پرداخت: {toPersianDigits(printDocument.total_rial)} ریال</div>
          </div>
          <div style={{ marginTop: '25px', borderTop: '1px solid #bbb', paddingTop: '10px', fontSize: '10px', lineHeight: 1.9 }}>
            نشانی فروشنده: {printDocument.seller_address_snapshot || '—'} · تلفن: {printDocument.seller_phone_snapshot || '—'}<br />
            بانک: {printDocument.seller_bank_name_snapshot || '—'} · شبا: {printDocument.seller_iban_snapshot || '—'}<br />
            شرایط: {printDocument.terms || '—'}<br />
            توضیحات: {printDocument.notes || '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', fontSize: '10px' }}>
            <span>مهر و امضای فروشنده</span><span>امضای خریدار</span>
          </div>
          <p className="muted" style={{ marginTop: '24px', fontSize: '9px', textAlign: 'center' }}>این سند، صورتحساب تجاری داخلی است و به‌تنهایی رسید ارسال به سامانه مؤدیان محسوب نمی‌شود.</p>
        </div>
      )}
    </div>
  );
}
