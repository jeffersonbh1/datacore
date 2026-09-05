import React, { useId } from 'react';

interface LogoProps {
  iconSize?: number;
  showWordmark?: boolean;
  wordmarkClassName?: string;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  iconSize = 40,
  showWordmark = true,
  wordmarkClassName = 'text-lg',
  className = ''
}) => {
  const uid = useId().replace(/:/g, '');
  const glowId = `coreGlow-${uid}`;
  const fillId = `coreFill-${uid}`;
  const pathAId = `pathA-${uid}`;
  const pathBId = `pathB-${uid}`;
  const pathCId = `pathC-${uid}`;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative shrink-0" style={{ width: iconSize, height: iconSize }}>
        <div className="absolute inset-0 rounded-full border border-dashed border-[#C9D1DC] animate-spin-slow" />
        <svg viewBox="0 0 200 200" width={iconSize} height={iconSize} className="block overflow-visible">
          <defs>
            <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0FA98F" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#0FA98F" stopOpacity={0} />
            </radialGradient>
            <linearGradient id={fillId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#E7ECF1" />
            </linearGradient>
          </defs>

          <circle cx="100" cy="100" r="46" fill={`url(#${glowId})`} />

          <path id={pathAId} d="M 40,55 C 65,55 78,75 100,100" fill="none" stroke="#C9D1DC" strokeWidth={2} />
          <path id={pathBId} d="M 160,55 C 135,55 122,75 100,100" fill="none" stroke="#C9D1DC" strokeWidth={2} />
          <path id={pathCId} d="M 100,160 C 100,135 100,125 100,100" fill="none" stroke="#C9D1DC" strokeWidth={2} />

          <circle cx="40" cy="55" r="7" fill="#F2F4F8" stroke="#0FA98F" strokeWidth={2.5} />
          <circle cx="160" cy="55" r="7" fill="#F2F4F8" stroke="#E0632B" strokeWidth={2.5} />
          <circle cx="100" cy="160" r="7" fill="#F2F4F8" stroke="#0FA98F" strokeWidth={2.5} />

          <polygon
            points="100,76 121,88 121,112 100,124 79,112 79,88"
            fill={`url(#${fillId})`}
            stroke="#0FA98F"
            strokeWidth={2.5}
          >
            <animateTransform
              attributeName="transform"
              type="scale"
              values="1;1.07;1"
              additive="sum"
              keyTimes="0;0.5;1"
              dur="2.4s"
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
              transformOrigin="100 100"
            />
          </polygon>
          <polygon
            points="100,76 121,88 121,112 100,124 79,112 79,88"
            fill="none"
            stroke="#0FA98F"
            strokeWidth={1}
            opacity={0.35}
          />

          <circle r={4.2} fill="#0FA98F">
            <animateMotion dur="2.4s" repeatCount="indefinite" begin="0s">
              <mpath href={`#${pathAId}`} />
            </animateMotion>
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="2.4s" repeatCount="indefinite" begin="0s" />
          </circle>

          <circle r={4.2} fill="#E0632B">
            <animateMotion dur="2.4s" repeatCount="indefinite" begin="0.8s">
              <mpath href={`#${pathBId}`} />
            </animateMotion>
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="2.4s" repeatCount="indefinite" begin="0.8s" />
          </circle>

          <circle r={4.2} fill="#0FA98F">
            <animateMotion dur="2.4s" repeatCount="indefinite" begin="1.6s">
              <mpath href={`#${pathCId}`} />
            </animateMotion>
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="2.4s" repeatCount="indefinite" begin="1.6s" />
          </circle>
        </svg>
      </div>

      {showWordmark && (
        <span
          className={`font-semibold tracking-tight whitespace-nowrap ${wordmarkClassName}`}
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          <span className="text-slate-900">DATA</span>
          <span className="text-[#0FA98F]">CORE</span>
        </span>
      )}
    </div>
  );
};
