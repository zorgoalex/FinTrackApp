function CurrencySelector({ currencies = [], value, onChange, disabled = false, className = '' }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`input-field text-sm ${className}`}
      data-testid="currency-selector"
    >
      <option value="" disabled>
        Выберите валюту
      </option>
      {currencies.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.code} {currency.symbol}
        </option>
      ))}
    </select>
  );
}

export default CurrencySelector;
