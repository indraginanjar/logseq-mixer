import React, { useEffect, useRef, useState } from 'react';
import { styled } from '../stitches.config';
import { MaximizeOverlay, MaximizeButton, useMaximize } from './MaximizeOverlay';
import { encodePlantUML } from '../utils/plantumlEncoder';

const ChartContainer = styled('div', {
  padding: '12px',
  backgroundColor: '#f8f9fa',
  borderRadius: '8px',
  border: '1px solid $slate5',
  overflow: 'auto',
  backgroundImage: 'linear-gradient(45deg, #e9ecef 25%, transparent 25%), linear-gradient(-45deg, #e9ecef 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e9ecef 75%), linear-gradient(-45deg, transparent 75%, #e9ecef 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  '& img': {
    maxWidth: '100%',
    height: 'auto',
  },
});

const ErrorText = styled('div', {
  fontSize: '11px',
  color: '$red11',
  padding: '8px',
});

const LoadingText = styled('div', {
  fontSize: '11px',
  color: '$slate10',
  padding: '8px',
});

const FixButton = styled('button', {
  fontSize: '11px',
  padding: '4px 10px',
  borderRadius: '4px',
  border: '1px solid $blue6',
  backgroundColor: '$blue3',
  color: '$blue11',
  cursor: 'pointer',
  marginTop: '6px',
  transition: 'all 0.15s',
  '&:hover': {
    backgroundColor: '$blue4',
    borderColor: '$blue7',
  },
  '&:disabled': {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
});

const FixingText = styled('div', {
  fontSize: '11px',
  color: '$blue10',
  padding: '4px 0',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

interface PlantUMLChartProps {
  code: string;
  onCodeFixed?: (fixedCode: string) => void;
}

const MAX_AUTO_FIX_ATTEMPTS = 2;

export default React.memo(function PlantUMLChart({ code, onCodeFixed }: PlantUMLChartProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixAttempts, setFixAttempts] = useState(0);
  const [autoFixDone, setAutoFixDone] = useState(false);
  const attemptedCodesRef = useRef<Set<string>>(new Set());
  const { isMaximized, open: openMaximize, close: closeMaximize } = useMaximize();

  useEffect(() => {
    if (!attemptedCodesRef.current.has(code.trim())) {
      setFixAttempts(0);
      setAutoFixDone(false);
      attemptedCodesRef.current.clear();
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    const trimmedCode = code.trim();

    setLoading(true);
    setError(null);
    setSvgUrl(null);

    const buildUrl = async () => {
      if (cancelled) return;

      try {
        const settings = (window as any).logseq?.settings ?? (typeof logseq !== 'undefined' ? (logseq as any).settings : null);
        const serverBase = settings?.plantumlServer || 'https://www.plantuml.com/plantuml';
        // Ensure no trailing slash
        const server = serverBase.replace(/\/+$/, '');

        const encoded = await encodePlantUML(trimmedCode);
        const url = `${server}/svg/${encoded}`;

        if (!cancelled) {
          setSvgUrl(url);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to encode PlantUML');
          setLoading(false);
        }
      }
    };

    buildUrl();

    return () => { cancelled = true; };
  }, [code]);

  const handleImgLoad = () => {
    setLoading(false);
    setError(null);
  };

  const handleImgError = () => {
    const errorMsg = 'PlantUML server returned an error. The diagram may have syntax issues.';
    setLoading(false);
    setError(errorMsg);

    // Auto-fix
    const trimmedCode = code.trim();
    if (fixAttempts < MAX_AUTO_FIX_ATTEMPTS && !autoFixDone && onCodeFixed && !attemptedCodesRef.current.has(trimmedCode)) {
      triggerAutoFix(trimmedCode, errorMsg);
    } else {
      setAutoFixDone(true);
    }
  };

  const triggerAutoFix = async (brokenCode: string, errorMsg: string) => {
    if (!onCodeFixed || fixing) return;

    if (attemptedCodesRef.current.has(brokenCode)) {
      setAutoFixDone(true);
      return;
    }
    attemptedCodesRef.current.add(brokenCode);

    setFixing(true);
    setFixAttempts(prev => prev + 1);

    try {
      const { fixPlantUMLWithLLM } = await import('../utils/plantumlFixer');
      const settings = (window as any).logseq?.settings ?? (typeof logseq !== 'undefined' ? (logseq as any).settings : null);
      if (!settings) {
        setAutoFixDone(true);
        return;
      }

      const fixedCode = await fixPlantUMLWithLLM(brokenCode, errorMsg, {
        selectedModel: settings.selectedModel,
        apiKey: settings.apiKey,
        chatEndpoint: settings.chatEndpoint,
        chatProvider: settings.chatProvider,
        LiteLLMLink: settings.LiteLLMLink,
      });

      if (fixedCode && fixedCode !== brokenCode) {
        attemptedCodesRef.current.add(fixedCode);
        onCodeFixed(fixedCode);
      } else {
        setAutoFixDone(true);
      }
    } catch (e) {
      console.error('[PlantUMLChart] Auto-fix failed:', e);
      setAutoFixDone(true);
    } finally {
      setFixing(false);
    }
  };

  const handleManualFix = () => {
    if (!error || !onCodeFixed) return;
    setFixAttempts(0);
    setAutoFixDone(false);
    attemptedCodesRef.current.clear();
    triggerAutoFix(code.trim(), error);
  };

  const handleCopy = async () => {
    try {
      const img = imgRef.current;
      if (!img) return;
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        } catch {
          // Fallback: copy SVG URL
          if (svgUrl) await navigator.clipboard.writeText(svgUrl);
        }
      }, 'image/png');
    } catch { /* ignore */ }
  };

  if (error) {
    return (
      <ChartContainer>
        <ErrorText>⚠️ {error}</ErrorText>
        {fixing && (
          <FixingText>
            <span style={{ display: 'inline-block' }}>🔄</span>
            Fixing with AI (attempt {fixAttempts}/{MAX_AUTO_FIX_ATTEMPTS})...
          </FixingText>
        )}
        {!fixing && onCodeFixed && !autoFixDone && (
          <FixingText>
            <span style={{ display: 'inline-block' }}>🔄</span>
            Fixing with AI...
          </FixingText>
        )}
        {!fixing && autoFixDone && onCodeFixed && (
          <FixButton onClick={handleManualFix} disabled={fixing}>
            🔧 Fix with AI
          </FixButton>
        )}
        <pre style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{code}</pre>
      </ChartContainer>
    );
  }

  return (
    <>
      <ChartContainer>
        {loading && <LoadingText>Rendering PlantUML diagram...</LoadingText>}
        {svgUrl && (
          <img
            ref={imgRef}
            src={svgUrl}
            alt="PlantUML diagram"
            onLoad={handleImgLoad}
            onError={handleImgError}
            style={{ display: loading ? 'none' : 'block' }}
            crossOrigin="anonymous"
          />
        )}
      </ChartContainer>
      {!loading && !error && svgUrl && (
        <MaximizeButton
          onClick={openMaximize}
          title="View fullscreen"
          style={{ position: 'absolute', top: 8, right: 8 }}
        >
          ⛶ Maximize
        </MaximizeButton>
      )}
      <MaximizeOverlay open={isMaximized} onClose={closeMaximize}>
        {svgUrl && <img src={svgUrl} alt="PlantUML diagram" style={{ maxWidth: '100%', height: 'auto' }} />}
      </MaximizeOverlay>
    </>
  );
});
