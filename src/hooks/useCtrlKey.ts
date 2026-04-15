import { useEffect, useState } from 'react';
import { useMountedState } from './useMountedState';

export function useCtrlKey(): boolean {
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const isMounted = useMountedState();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isMounted() && event.ctrlKey) {
        setCtrlHeld(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isMounted() && !event.ctrlKey) {
        setCtrlHeld(false);
      }
    };

    const handleBlur = () => {
      if (isMounted()) {
        setCtrlHeld(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isMounted]);

  return ctrlHeld;
}
