import React, { useCallback, useEffect, useRef, useState } from 'react';
import { styled } from '../stitches.config';

const Wrapper = styled('div', {
  position: 'relative',
  maxWidth: '140px',
  minWidth: 0,
  flexShrink: 1,
});

const Trigger = styled('button', {
  background: 'transparent',
  border: '1px solid $slate6',
  borderRadius: '6px',
  padding: '4px 24px 4px 8px',
  cursor: 'pointer',
  color: '$slate10',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all 0.15s',
  outline: 'none',
  fontFamily: '$sans',
  width: '100%',
  textAlign: 'left',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 6px center',
  backgroundSize: '12px',
  '&:hover': { backgroundColor: '$slate3', borderColor: '$slate8', color: '$highContrast' },
  '&:focus': { borderColor: '$blue8' },
});

const SearchTrigger = styled('input', {
  background: 'transparent',
  border: '1px solid $slate6',
  borderRadius: '6px',
  padding: '4px 24px 4px 8px',
  cursor: 'pointer',
  color: '$slate10',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all 0.15s',
  outline: 'none',
  fontFamily: '$sans',
  width: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 6px center',
  backgroundSize: '12px',
  '&:hover': { backgroundColor: '$slate3', borderColor: '$slate8', color: '$highContrast' },
  '&:focus': { borderColor: '$blue8', cursor: 'text' },
  '&::placeholder': { color: '$slate8' },
});

const Dropdown = styled('div', {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: '2px',
  backgroundColor: '$elevation0',
  border: '1px solid $slate6',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  zIndex: 200,
  overflow: 'hidden',
  minWidth: '180px',
});

const OptionList = styled('div', {
  maxHeight: '200px',
  overflowY: 'auto',
  '&::-webkit-scrollbar': { width: '4px' },
  '&::-webkit-scrollbar-thumb': { backgroundColor: '$slate6', borderRadius: '2px' },
});

const Option = styled('div', {
  padding: '5px 8px',
  fontSize: '12px',
  cursor: 'pointer',
  color: '$slate11',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: '$slate3', color: '$highContrast' },
  variants: {
    active: {
      true: { backgroundColor: '$blue4', color: '$blue11' },
    },
  },
});

const NoResults = styled('div', {
  padding: '8px',
  fontSize: '11px',
  color: '$slate8',
  textAlign: 'center',
});

interface ModelSelectorProps {
  value: string;
  choices: string[];
  onChange: (model: string) => void;
}

export default function ModelSelector({ value, choices, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? choices.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : choices;

  const handleSelect = useCallback((model: string) => {
    onChange(model);
    setOpen(false);
    setSearch('');
  }, [onChange]);

  const handleFocus = () => {
    setOpen(true);
    setSearch('');
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Don't close if clicking inside the dropdown
    if (wrapperRef.current?.contains(e.relatedTarget as Node)) return;
    // Delay to allow click on option to register
    setTimeout(() => {
      if (!wrapperRef.current?.contains(document.activeElement)) {
        setOpen(false);
        setSearch('');
      }
    }, 150);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
      inputRef.current?.blur();
    } else if (e.key === 'Enter' && filtered.length > 0) {
      handleSelect(filtered[0]);
      inputRef.current?.blur();
    }
  };

  return (
    <Wrapper ref={wrapperRef}>
      <SearchTrigger
        ref={inputRef}
        value={open ? search : value}
        placeholder={value}
        onChange={e => { setSearch(e.target.value); if (!open) setOpen(true); }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-label="Select Model"
        title={value}
      />
      {open && (
        <Dropdown>
          <OptionList>
            {filtered.length === 0 && <NoResults>No models found</NoResults>}
            {filtered.map(model => (
              <Option
                key={model}
                active={model === value}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(model); }}
                title={model}
              >
                {model}
              </Option>
            ))}
          </OptionList>
        </Dropdown>
      )}
    </Wrapper>
  );
}
