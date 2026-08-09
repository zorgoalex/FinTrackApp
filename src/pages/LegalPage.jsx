import { Link } from 'react-router-dom';

const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || 'support@fintrackapp.vip';

export default function LegalPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-800 dark:bg-gray-900 dark:text-gray-100 sm:py-12">
      <article className="mx-auto max-w-3xl space-y-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-10">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600">Закрытый beta-пилот</p>
          <h1 className="mt-2 text-3xl font-bold">Условия и конфиденциальность</h1>
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Версия от 10 августа 2026 года</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Что важно знать до начала работы</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
            <li>FinTrackApp находится в beta-тестировании и может содержать ошибки.</li>
            <li>Не используйте приложение как единственную копию финансовых данных: регулярно сохраняйте JSON-backup.</li>
            <li>Сводки, прогнозы и подсказки не являются бухгалтерской, налоговой или инвестиционной консультацией.</li>
            <li>Доступ предназначен только для приглашённых участников закрытого пилота.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Какие данные обрабатываются</h2>
          <p className="text-sm leading-6">Мы храним данные аккаунта, рабочих пространств, финансовых операций, настроек, приглашений и технической доставки уведомлений. Доступ между пространствами ограничивается ролями и политиками базы данных.</p>
          <p className="text-sm leading-6">Если офлайн-хранение включено в личном кабинете, справочники и несинхронизированные расходы временно сохраняются в браузере этого устройства с привязкой к аккаунту. Они удаляются при выходе или отключении этой настройки. Не используйте офлайн-хранение на общем устройстве.</p>
          <p className="text-sm leading-6">Фото чеков временно передаются на собственный GLM-OCR сервер только после вашего явного согласия. Оригинал, имя файла и необработанный OCR-текст не сохраняются; при недоступности сервера может использоваться локальный OCR в браузере.</p>
          <p className="text-sm leading-6">При голосовом вводе аудио временно передаётся через защищённую серверную функцию провайдеру распознавания речи. Аудиофайл не сохраняется в базе FinTrackApp. Telegram подключается только по вашему выбору.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Срок хранения и удаление</h2>
          <p className="text-sm leading-6">Подтверждённые финансовые данные и служебные метаданные хранятся, пока существует соответствующее пространство или аккаунт. Исходники чеков, raw OCR и аудио после обработки не сохраняются. Технические журналы инфраструктурных провайдеров регулируются их собственными сроками хранения.</p>
          <p className="text-sm leading-6">Аккаунт и связанные данные можно удалить самостоятельно в личном кабинете после подтверждения текущим паролем. До удаления сохраните экспорт: операция необратима. Удаление аккаунта владельца удалит принадлежащие ему пространства и данные всех их участников. Если войти в аккаунт невозможно, отправьте запрос с email аккаунта на адрес поддержки; после проверки владельца запрос выполняется в срок до 7 календарных дней.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Поддержка и запросы по данным</h2>
          <p className="text-sm leading-6">Единый канал: <a className="font-medium text-primary-600 underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
        </section>

        <footer className="border-t border-gray-200 pt-5 text-sm dark:border-gray-700">
          <Link className="font-medium text-primary-600 underline" to="/login">Вернуться ко входу</Link>
        </footer>
      </article>
    </main>
  );
}
