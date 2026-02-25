import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

const TagInput = forwardRef(function TagInput(
  { allTags = [], selected = [], onChange, placeholder = 'Добавить тег...' },
  ref
) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef(null);

  // Keep refs in sync so imperative getAllTags() always reads latest values
  const inputValueRef = useRef(inputValue);
  const selectedRef = useRef(selected);
  useEffect(() => { inputValueRef.current = inputValue; }, [inputValue]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Expose getAllTags() so parent can synchronously read committed+pending tags on submit
  useImperativeHandle(ref, () => ({
    getAllTags: () => {
      const val = inputValueRef.current.trim();
      if (!val) return selectedRef.current;
      const names = new Set(selectedRef.current.map((t) => t.name.toLowerCase()));
      if (names.has(val.toLowerCase())) return selectedRef.current;
      const match = allTags.find((t) => t.name.toLowerCase() === val.toLowerCase());
      return [...selectedRef.current, match || { id: null, name: val, color: '#6B7280' }];
    }
  }));

  const selectedNames = new Set(selected.map((t) => t.name.toLowerCase()));

  const filtered = allTags
    .filter((t) => !selectedNames.has(t.name.toLowerCase()))
    .filter((t) => !inputValue.trim() || t.name.toLowerCase().includes(inputValue.trim().toLowerCase()))
    .slice(0, 8);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addTag = (tag) => {
    if (selectedNames.has(tag.name.toLowerCase())) return;
    onChange([...selected, tag]);
    setInputValue('');
    setShowSuggestions(false);
  };

  const removeTag = (index) => {
    onChange(selected.filter((_, i) => i !== index));
  };

  const commitInput = () => {
    const val = inputValue.trim();
    if (!val) return;
    const match = allTags.find((t) => t.name.toLowerCase() === val.toLowerCase());
    addTag(match || { id: null, name: val, color: '#6B7280' });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && !inputValue && selected.length > 0) {
      removeTag(selected.length - 1);
    }
  };

  const handleBlur = () => {
    commitInput();
    setShowSuggestions(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map((tag, i) => (
            <span
              key={tag.id || tag.name}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200"
            >
              #{tag.name}
              <button
                type="button"
                onClick={() => removeTag(i)}
                className="text-indigo-400 hover:text-indigo-700 leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="input-field text-sm"
        data-testid="tag-input"
      />

      {/* Suggestions dropdown */}
      {showSuggestions && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {filtered.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(tag)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors"
            >
              #{tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default TagInput;
