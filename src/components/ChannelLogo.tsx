import { useState, type CSSProperties } from 'react';
import { isMixedContent, proxied } from '../lib/proxy';
import { hueOf, initials } from '../lib/text';
import type { Channel } from '../lib/types';
import { useProxyEndpoint } from '../store/hooks';

/** Channel logo with a tinted-initials placeholder for missing or broken images. */
export function ChannelLogo({ channel, size = 40 }: { channel: Channel; size?: number }) {
  const endpoint = useProxyEndpoint();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const style = { '--size': `${size}px`, '--hue': hueOf(channel.name) } as CSSProperties;

  // Plain-HTTP logos are blocked on HTTPS pages; the proxy can fetch them instead.
  const logo = channel.logo;
  const src = logo && endpoint && isMixedContent(logo) ? proxied(endpoint, logo, { raw: true }) : logo;

  if (!src || failedSrc === src) {
    return (
      <span className="logo logo--placeholder" style={style} aria-hidden="true">
        {initials(channel.name)}
      </span>
    );
  }
  return (
    <span className="logo" style={style} aria-hidden="true">
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailedSrc(src)}
      />
    </span>
  );
}
