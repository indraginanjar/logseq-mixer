import React from 'react';
import { openUrl } from 'utils/urlClassifier';

type CtrlLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>;

export function CtrlLink({ children, href, ...rest }: CtrlLinkProps) {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (event.ctrlKey && href) {
      openUrl(href);
    }
  };

  return (
    <a {...rest} href={href} className="ctrl-link" onClick={handleClick}>
      {children}
    </a>
  );
}
