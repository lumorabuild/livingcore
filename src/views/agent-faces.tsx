/** @jsxImportSource hono/jsx */
// Kevin & Jenny portrait SVGs — server-rendered, no framework classes (the
// Tailwind CDN is gone). Callers wrap these in their own layout; the faces
// themselves are just the <svg>.

interface AgentFaceProps {
  mood?: 'neutral' | 'thinking' | 'happy' | 'surprised' | 'sad';
  speaking?: boolean;
  size?: number;
}

export function KevinFace({ mood = 'neutral', speaking = false, size = 72 }: AgentFaceProps) {
  const skin = '#c99a72';
  const hair = '#3a2d22';
  const eyeColor = '#0f6f68';
  const mouthColor = '#5c4633';
  const bgColor = 'rgba(31,143,135,0.10)';

  const mouths: Record<string, [string, string]> = {
    neutral: ['M20 52 Q24 54 28 52', 'M20 51 Q24 56 28 51'],
    thinking: ['M21 51 L27 51', 'M21 50 Q24 54 27 50'],
    happy: ['M19 52 Q24 57 29 52', 'M19 50 Q24 57 29 50'],
    surprised: ['M22 52 Q24 55 26 52', 'M22 50 Q24 56 26 50'],
    sad: ['M20 55 Q24 51 28 55', 'M20 54 Q24 52 28 54'],
  };
  const [mouthClosed, mouthOpen] = mouths[mood] || mouths.neutral;
  const mouthPath = speaking ? mouthOpen : mouthClosed;
  const eyeH: Record<string, number> = { neutral: 3, thinking: 1.5, happy: 2, surprised: 5, sad: 2.5 };
  const eh = eyeH[mood] || 3;

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" role="img" aria-label="Kevin">
      <circle cx="40" cy="40" r="38" fill={bgColor} />
      <path d="M14 22 Q24 8 40 8 Q56 8 66 22 Q68 26 66 30 Q60 28 56 30 Q50 22 40 22 Q30 22 24 30 Q20 28 14 30 Q12 26 14 22Z" fill={hair} />
      <ellipse cx="40" cy="42" rx="22" ry="24" fill={skin} />
      <rect x="28" y="34" width="7" height={eh} rx="2" fill={eyeColor} />
      <rect x="45" y="34" width="7" height={eh} rx="2" fill={eyeColor} />
      <path d="M26 30 Q30 28 36 30" stroke={hair} stroke-width="1.2" fill="none" />
      <path d="M44 30 Q50 28 54 30" stroke={hair} stroke-width="1.2" fill="none" />
      <path d={mouthPath} stroke={mouthColor} stroke-width="2" fill="none" stroke-linecap="round" />
    </svg>
  );
}

export function JennyFace({ mood = 'neutral', speaking = false, size = 72 }: AgentFaceProps) {
  const skin = '#d9a68a';
  const hair = '#4a2f3d';
  const eyeColor = '#a3134f';
  const mouthColor = '#7a4f57';
  const bgColor = 'rgba(194,24,91,0.10)';

  const mouths: Record<string, [string, string]> = {
    neutral: ['M20 52 Q25 54 30 52', 'M20 51 Q25 56 30 51'],
    thinking: ['M22 51 L28 51', 'M22 50 Q25 54 28 50'],
    happy: ['M19 51 Q25 57 31 51', 'M19 49 Q25 57 31 49'],
    surprised: ['M23 52 Q25 55 27 52', 'M23 50 Q25 56 27 50'],
    sad: ['M21 55 Q25 51 29 55', 'M21 54 Q25 52 29 54'],
  };
  const [mouthClosed, mouthOpen] = mouths[mood] || mouths.neutral;
  const mouthPath = speaking ? mouthOpen : mouthClosed;
  const eyeH: Record<string, number> = { neutral: 3.5, thinking: 2, happy: 2.5, surprised: 5.5, sad: 3 };
  const eh = eyeH[mood] || 3.5;

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" role="img" aria-label="Jenny">
      <circle cx="40" cy="40" r="38" fill={bgColor} />
      <path d="M12 24 Q22 6 40 6 Q58 6 68 24 Q70 28 67 32 Q62 28 56 30 Q50 20 40 20 Q30 20 24 30 Q18 28 13 32 Q10 28 12 24Z" fill={hair} />
      <ellipse cx="40" cy="44" rx="24" ry="25" fill={skin} />
      <ellipse cx="29" cy="36" rx="4.5" ry={eh} fill={eyeColor} />
      <ellipse cx="51" cy="36" rx="4.5" ry={eh} fill={eyeColor} />
      <circle cx="29" cy="36" r="2" fill="#241f14" />
      <circle cx="51" cy="36" r="2" fill="#241f14" />
      <path d="M25 30 Q29 27 34 30" stroke={hair} stroke-width="1.5" fill="none" />
      <path d="M46 30 Q51 27 55 30" stroke={hair} stroke-width="1.5" fill="none" />
      <circle cx="22" cy="46" r="4" fill="rgba(194,24,91,0.18)" />
      <circle cx="58" cy="46" r="4" fill="rgba(194,24,91,0.18)" />
      <path d={mouthPath} stroke={mouthColor} stroke-width="2" fill="none" stroke-linecap="round" />
    </svg>
  );
}

export function faceFor(agent: 'kevin' | 'jenny', props: AgentFaceProps = {}) {
  return agent === 'kevin' ? <KevinFace {...props} /> : <JennyFace {...props} />;
}
