import { BarChart3, ShieldCheck, Sparkles, WalletCards } from 'lucide-react';
import { BUILD_LABEL } from '../utils/buildInfo';

const benefits = [
  { icon: WalletCards, title: 'Все деньги в одном месте', text: 'Счета, валюты, долги и регулярные платежи.' },
  { icon: BarChart3, title: 'Решения на основе цифр', text: 'Бюджеты и аналитика без ручных таблиц.' },
  { icon: ShieldCheck, title: 'Доступ по ролям', text: 'Личные и командные пространства с контролем прав.' },
];

export default function AuthShell({ eyebrow = 'ФинУчёт', title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-700 via-primary-700 to-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
          <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="absolute -right-24 -top-16 h-96 w-96 rounded-full bg-fuchsia-400/20 blur-3xl" />
          <div className="relative">
            <div className="mb-16 flex items-center gap-3 text-xl font-bold">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 shadow-lg ring-1 ring-white/20"><Sparkles size={22} /></span>
              ФинУчёт
            </div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-200">Финансы семьи и небольшой команды</p>
            <h1 className="max-w-xl text-4xl font-bold leading-tight xl:text-5xl">Понимайте деньги.<br />Планируйте спокойно.</h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-indigo-100">От ежедневных расходов до управленческой картины — в одном понятном рабочем пространстве.</p>
          </div>
          <div className="relative grid gap-4 xl:grid-cols-3">
            {benefits.map(({ icon: Icon, title: itemTitle, text }) => (
              <div key={itemTitle} className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
                <Icon size={20} className="mb-3 text-cyan-200" />
                <p className="text-sm font-semibold">{itemTitle}</p>
                <p className="mt-1 text-xs leading-5 text-indigo-100">{text}</p>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-8 dark:bg-gray-900">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <div className="mb-3 flex items-center gap-2 text-xl font-bold text-primary-600 dark:text-primary-400"><Sparkles size={22} /> ФинУчёт</div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Финансы семьи и небольшой команды</p>
            </div>
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-400">{eyebrow}</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-950 dark:text-white">{title}</h2>
              {subtitle && <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{subtitle}</p>}
              <div className="mt-7">{children}</div>
            </section>
            <p className="mt-5 text-center text-[11px] text-gray-400 dark:text-gray-600" data-testid="build-version">Версия {BUILD_LABEL}</p>
          </div>
        </main>
      </div>
    </div>
  );
}
