import React from 'react';
import { css } from '../stitches.config';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  loading?: boolean;
}

const inputStyle = css({
  // Your existing styles
});

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ loading, onKeyDown, ...props }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !loading) {
        onKeyDown?.(e);
      }
    };

    return (
      <div className={inputStyle()} data-loading={loading}>
        <input
          ref={ref}
          {...props}
          onKeyDown={handleKeyDown}
          disabled={loading || props.disabled}
        />
        {loading && <div className="loader" />}
      </div>
    );
  }
);