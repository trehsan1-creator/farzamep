import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import { formatCurrency, formatIban, toPersianDigits, unitLabelFa } from '../lib/persian';

export function MasterDataView() {
  const { accounts, tafsilParties, products, fixedAssets, currencyUnit } = useFiscalYear();
  const [subTab, setSubTab] = useState<'accounts' | 'tafsil' | 'products' | 'assets'>('accounts');
  const [query, setQuery] = useState('');

  const filteredAccounts = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.trim().toLowerCase();
    return accounts.filter(
      (a) =>
        a.code.includes(q) ||
        a.name_fa.toLowerCase().includes(q) ||
        a.name_en.toLowerCase().includes(q) ||
        (a.tax_article_ref ?? '').toLowerCase().includes(q)
    );
  }, [accounts, query]);

  const unitFa = unitLabelFa(currencyUnit);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#F8FAFC]">کدینگ حساب‌ها و اطلاعات پایه</h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            ۱۵ حساب معین عملیاتی (<span className="mono-ltr">1100..7105</span>) به همراه ۵ حساب زیرمجموعه بستن و مالیات (
            <span className="mono-ltr">1108, 2106, 2107, 3105, 8101</span>)، تفصیلی‌ها، کالاها و اموال
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#1E3A72] p-1 text-xs">
          {(
            [
              { id: 'accounts', label: `کدینگ معین (${toPersianDigits(accounts.length)})` },
              { id: 'tafsil', label: `طرف حساب‌ها (${toPersianDigits(tafsilParties.length)})` },
              { id: 'products', label: `کالاها (${toPersianDigits(products.length)})` },
              { id: 'assets', label: `اموال ثابت (${toPersianDigits(fixedAssets.length)})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`rounded-md px-3 py-1.5 font-semibold whitespace-nowrap ${
                subTab === t.id ? 'bg-[#FF7A00] text-[#102333]' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {subTab === 'accounts' && (
        <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-5 space-y-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-[#94A3B8]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو بر اساس کد معین، نام فارسی/انگلیسی یا ماده قانونی..."
              aria-label="جستجو در کدینگ حساب‌ها"
              className="w-full rounded-lg border border-white/15 bg-[#102333] py-2 pr-9 pl-3 text-xs text-[#F8FAFC] placeholder-[#94A3B8] focus:border-[#FF7A00] focus:outline-none"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-white/15 text-[#94A3B8]">
                  <th className="p-2.5">کد معین</th>
                  <th className="p-2.5">کل</th>
                  <th className="p-2.5">عنوان فارسی</th>
                  <th className="p-2.5">عنوان لاتین</th>
                  <th className="p-2.5">ماهیت / نوع</th>
                  <th className="p-2.5">مرجع قانونی مالیاتی</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-white/5">
                    <td className="p-2.5 mono-ltr font-bold text-[#FF7A00]">{acc.code}</td>
                    <td className="p-2.5 mono-ltr text-[#94A3B8]">{acc.kol_code}</td>
                    <td className="p-2.5 font-semibold text-[#F8FAFC]">{acc.name_fa}</td>
                    <td className="p-2.5 text-[#94A3B8]" dir="ltr">
                      {acc.name_en}
                    </td>
                    <td className="p-2.5 text-[#F8FAFC]">
                      {acc.normal_balance === 'DEBIT' ? 'بدهکار' : 'بستانکار'} ·{' '}
                      <span className={acc.is_temporary ? 'text-[#FF7A00]' : 'text-[#10B981]'}>
                        {acc.is_temporary ? 'موقت' : 'دائمی'}
                      </span>
                      {acc.is_contra ? ' · کاهنده' : ''}
                    </td>
                    <td className="p-2.5 text-[#94A3B8]">{acc.tax_article_ref ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {subTab === 'tafsil' && (
        <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-5 overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/15 text-[#94A3B8]">
                <th className="p-2.5">کد تفصیلی</th>
                <th className="p-2.5">نام شخص حقیقی / حقوقی</th>
                <th className="p-2.5">گروه تفصیلی</th>
                <th className="p-2.5">شناسه ملی</th>
                <th className="p-2.5">شبا (IBAN)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {tafsilParties.map((t) => (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="p-2.5 mono-ltr font-bold text-[#FF7A00]">{t.code}</td>
                  <td className="p-2.5 font-semibold text-[#F8FAFC]">{t.name_fa}</td>
                  <td className="p-2.5 text-[#94A3B8]">{t.group_label ?? t.party_type}</td>
                  <td className="p-2.5 mono-ltr text-[#F8FAFC]">{t.national_id}</td>
                  <td className="p-2.5 mono-ltr text-[#94A3B8]">{formatIban(t.iban)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {subTab === 'products' && (
        <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-5 overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/15 text-[#94A3B8]">
                <th className="p-2.5">کد کالا (SKU)</th>
                <th className="p-2.5">شرح کالا</th>
                <th className="p-2.5">شناسه ۱۳ رقمی مودیان</th>
                <th className="p-2.5">واحد</th>
                <th className="p-2.5">بهای استاندارد ({unitFa})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-white/5">
                  <td className="p-2.5 mono-ltr font-bold text-[#FF7A00]">{p.sku}</td>
                  <td className="p-2.5 font-semibold text-[#F8FAFC]">{p.name_fa}</td>
                  <td className="p-2.5 mono-ltr text-[#10B981]">{p.moadian_commodity_id}</td>
                  <td className="p-2.5 text-[#94A3B8]">{p.unit_fa}</td>
                  <td className="p-2.5 num-ltr font-semibold text-[#F8FAFC]">
                    {p.standard_cost_rial == null ? 'ثبت نشده' : formatCurrency(p.standard_cost_rial, currencyUnit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {subTab === 'assets' && (
        <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-5 overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-white/15 text-[#94A3B8]">
                <th className="p-2.5">کد اموال</th>
                <th className="p-2.5">شرح دارایی ثابت</th>
                <th className="p-2.5">ردیف ۱۴۹</th>
                <th className="p-2.5">تاریخ تحصیل</th>
                <th className="p-2.5">بهای تمام‌شده ({unitFa})</th>
                <th className="p-2.5">مازاد استهلاک ({unitFa})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {fixedAssets.map((a) => (
                <tr key={a.id} className="hover:bg-white/5">
                  <td className="p-2.5 mono-ltr font-bold text-[#FF7A00]">{a.asset_code}</td>
                  <td className="p-2.5 font-semibold text-[#F8FAFC]">{a.name_fa}</td>
                  <td className="p-2.5 mono-ltr">{a.art149_row}</td>
                  <td className="p-2.5 num-ltr text-[#94A3B8]">{a.acquisition_jalali}</td>
                  <td className="p-2.5 num-ltr font-semibold">{formatCurrency(a.cost_rial, currencyUnit)}</td>
                  <td className={`p-2.5 num-ltr font-bold ${a.excess_disallowed_rial > 0 ? 'text-[#ED2F42]' : 'text-[#10B981]'}`}>
                    {formatCurrency(a.excess_disallowed_rial, currencyUnit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
