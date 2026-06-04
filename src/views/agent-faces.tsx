/** @jsxImportSource hono/jsx */
// Kevin & Jenny SVG Face components - rendered server-side, animated client-side via CSS

interface AgentFaceProps {
  mood?: 'neutral' | 'thinking' | 'happy' | 'surprised' | 'sad';
  speaking?: boolean;
  size?: number;
  showLabel?: boolean;
}

// Kevin: angular, analytical - square jaw, geometric
export function KevinFace({ mood = 'neutral', speaking = false, size = 80, showLabel = true }: AgentFaceProps) {
  const skin = '#5a7a8c';
  const hair = '#2d3748';
  const eyeColor = '#4ecdc4';
  const mouthColor = '#4a6670';
  const bgColor = 'rgba(78, 205, 196, 0.08)';
  const scale = size / 80;

  // Mouth paths: closed vs open (speaking)
  const mouths: Record<string, [string, string]> = {
    neutral: ['M20 52 Q24 54 28 52', 'M20 51 Q24 56 28 51'],
    thinking: ['M21 51 L27 51', 'M21 50 Q24 54 27 50'],
    happy: ['M19 52 Q24 57 29 52', 'M19 50 Q24 57 29 50'],
    surprised: ['M22 52 Q24 55 26 52', 'M22 50 Q24 56 26 50'],
    sad: ['M20 55 Q24 51 28 55', 'M20 54 Q24 52 28 54'],
  };
  const [mouthClosed, mouthOpen] = mouths[mood] || mouths.neutral;
  const mouthPath = speaking ? mouthOpen : mouthClosed;

  // Eye height per mood
  const eyeH: Record<string, number> = { neutral: 3, thinking: 1.5, happy: 2, surprised: 5, sad: 2.5 };
  const eh = eyeH[mood] || 3;

  return (
    <div class="flex flex-col items-center gap-1" style="user-select:none;">
      <svg width={size} height={size} viewBox="0 0 80 80" style="filter:drop-shadow(0 2px 8px rgba(78,205,196,0.2));">
        <circle cx="40" cy="40" r="38" fill={bgColor} />
        {/* Hair */}
        <path d="M14 22 Q24 8 40 8 Q56 8 66 22 Q68 26 66 30 Q60 28 56 30 Q50 22 40 22 Q30 22 24 30 Q20 28 14 30 Q12 26 14 22Z" fill={hair} />
        {/* Face oval */}
        <ellipse cx="40" cy="42" rx="22" ry="24" fill={skin} />
        {/* Eyes */}
        <g class="eye-blink">
          <rect x="28" y="34" width="7" height={eh} rx="2" fill={eyeColor} />
          <rect x="45" y="34" width="7" height={eh} rx="2" fill={eyeColor} />
        </g>
        {/* Eyebrows */}
        <path d="M26 30 Q30 28 36 30" stroke={hair} stroke-width="1.2" fill="none" />
        <path d="M44 30 Q50 28 54 30" stroke={hair} stroke-width="1.2" fill="none" />
        {/* Mouth */}
        <path d={mouthPath} stroke={mouthColor} stroke-width="2" fill="none" stroke-linecap="round" />
        {/* Speaking indicator dots */}
        {speaking && (
          <g class="pulse-glow">
            <circle cx="12" cy="45" r="2" fill={eyeColor} />
            <circle cx="8" cy="42" r="1.5" fill={eyeColor} />
            <circle cx="14" cy="39" r="1" fill={eyeColor} />
          </g>
        )}
      </svg>
      {showLabel && <span class="text-xs font-medium text-[#4ecdc4]">Kevin</span>}
    </div>
  );
}

// Jenny: curved, exploratory - round face, softer
export function JennyFace({ mood = 'neutral', speaking = false, size = 80, showLabel = true }: AgentFaceProps) {
  const skin = '#8b6f7a';
  const hair = '#3d2b3a';
  const eyeColor = '#ff6b9d';
  const mouthColor = '#6d5562';
  const bgColor = 'rgba(255, 107, 157, 0.08)';
  const scale = size / 80;

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
    <div class="flex flex-col items-center gap-1" style="user-select:none;">
      <svg width={size} height={size} viewBox="0 0 80 80" style="filter:drop-shadow(0 2px 8px rgba(255,107,157,0.2));">
        <circle cx="40" cy="40" r="38" fill={bgColor} />
        {/* Hair - wavy, softer */}
        <path d="M12 24 Q22 6 40 6 Q58 6 68 24 Q70 28 67 32 Q62 28 56 30 Q50 20 40 20 Q30 20 24 30 Q18 28 13 32 Q10 28 12 24Z" fill={hair} />
        <path d="M16 20 Q28 4 40 4 Q52 4 64 20" stroke={hair} stroke-width="3" fill="none" opacity="0.3" />
        {/* Face - rounder */}
        <ellipse cx="40" cy="44" rx="24" ry="25" fill={skin} />
        {/* Eyes - larger, rounder */}
        <g class="eye-blink">
          <ellipse cx="29" cy="36" rx="4.5" ry={eh} fill={eyeColor} />
          <ellipse cx="51" cy="36" rx="4.5" ry={eh} fill={eyeColor} />
          {/* Pupils */}
          <circle cx="29" cy="36" r="2" fill="#1a1f2e" />
          <circle cx="51" cy="36" r="2" fill="#1a1f2e" />
        </g>
        {/* Eyebrows - curved */}
        <path d="M25 30 Q29 27 34 30" stroke={hair} stroke-width="1.5" fill="none" />
        <path d="M46 30 Q51 27 55 30" stroke={hair} stroke-width="1.5" fill="none" />
        {/* Rosy cheeks */}
        <circle cx="22" cy="46" r="4" fill="rgba(255,107,157,0.15)" />
        <circle cx="58" cy="46" r="4" fill="rgba(255,107,157,0.15)" />
        {/* Mouth */}
        <path d={mouthPath} stroke={mouthColor} stroke-width="2" fill="none" stroke-linecap="round" />
        {speaking && (
          <g class="pulse-glow">
            <circle cx="68" cy="45" r="2" fill={eyeColor} />
            <circle cx="72" cy="42" r="1.5" fill={eyeColor} />
            <circle cx="66" cy="39" r="1" fill={eyeColor} />
          </g>
        )}
      </svg>
      {showLabel && <span class="text-xs font-medium text-[#ff6b9d]">Jenny</span>}
    </div>
  );
}

// Thinking wave bars
export function ThinkingBars({ color = '#4ecdc4' }: { color?: string }) {
  return (
    <div class="flex items-center gap-[3px] h-4">
      <div class="thinking-bar w-[3px] h-3 rounded-full" style={`background:${color};`}></div>
      <div class="thinking-bar w-[3px] h-4 rounded-full" style={`background:${color};`}></div>
      <div class="thinking-bar w-[3px] h-[10px] rounded-full" style={`background:${color};`}></div>
    </div>
  );
}

// Coherence gauge
export function CoherenceGauge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 60 ? '#4ecdc4' : pct >= 35 ? '#e2b714' : '#ff6b9d';
  return (
    <div class="flex items-center gap-2">
      <div class="w-20 h-1.5 bg-[#2f3336] rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all duration-1000" style={`width:${pct}%;background:${color};`}></div>
      </div>
      <span class="text-xs font-mono text-[#71767b]">{pct}%</span>
    </div>
  );
}
