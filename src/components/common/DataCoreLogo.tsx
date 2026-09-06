import React, { useId } from 'react';

interface DataCoreLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  showTagline?: boolean;
  layout?: 'horizontal' | 'vertical' | 'stage';
  className?: string;
  iconOnly?: boolean;
}

export const DataCoreLogo: React.FC<DataCoreLogoProps> = ({
  size = 'sm',
  showWordmark = true,
  showTagline = false,
  layout = 'horizontal',
  className = '',
  iconOnly = false,
}) => {
  const rawId = useId();
  const uid = `dc_${rawId.replace(/[^a-zA-Z0-9]/g, '_')}`;

  // Dimensions configuration according to size
  const config = {
    xs: {
      iconSize: 24,
      fontSize: 'text-sm font-bold',
      taglineSize: 'text-[8px]',
      gap: 'gap-1.5',
      stageGap: 'gap-1',
      taglineOffset: 'mt-0'
    },
    sm: {
      iconSize: 34,
      fontSize: 'text-base font-bold',
      taglineSize: 'text-[9px]',
      gap: 'gap-2.5',
      stageGap: 'gap-1.5',
      taglineOffset: 'mt-0.5'
    },
    md: {
      iconSize: 56,
      fontSize: 'text-2xl font-bold',
      taglineSize: 'text-[11px]',
      gap: 'gap-3.5',
      stageGap: 'gap-2',
      taglineOffset: '-mt-1'
    },
    lg: {
      iconSize: 76,
      fontSize: 'text-3xl font-bold',
      taglineSize: 'text-xs',
      gap: 'gap-4',
      stageGap: 'gap-2.5',
      taglineOffset: '-mt-2'
    },
    xl: {
      iconSize: 120,
      fontSize: 'text-[40px] font-bold',
      taglineSize: 'text-[13px]',
      gap: 'gap-5',
      stageGap: 'gap-3',
      taglineOffset: '-mt-3'
    }
  }[size];

  // SVG Icon element
  const iconElement = (
    <div 
      className="relative shrink-0 flex items-center justify-center"
      style={{ width: `${config.iconSize}px`, height: `${config.iconSize}px` }}
    >
      {/* Dashed outer rotating ring */}
      <div 
        className="absolute inset-0 rounded-full border border-dashed border-[#C9D1DC] pointer-events-none"
        style={{ 
          animation: 'dataCoreSpin 26s linear infinite',
        }} 
      />

      {/* Core SVG Logo */}
      <svg 
        viewBox="0 0 200 200" 
        width={config.iconSize} 
        height={config.iconSize}
        className="block overflow-visible"
      >
        <defs>
          <radialGradient id={`${uid}_coreGlow`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0FA98F" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#0FA98F" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}_coreFill`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#E7ECF1" />
          </linearGradient>
        </defs>

        {/* Ambient Core Glow */}
        <circle cx="100" cy="100" r="46" fill={`url(#${uid}_coreGlow)`} />

        {/* Pipeline Paths */}
        <path 
          id={`${uid}_pathA`} 
          d="M 40,55 C 65,55 78,75 100,100" 
          fill="none" 
          stroke="#C9D1DC" 
          strokeWidth="2" 
        />
        <path 
          id={`${uid}_pathB`} 
          d="M 160,55 C 135,55 122,75 100,100" 
          fill="none" 
          stroke="#C9D1DC" 
          strokeWidth="2" 
        />
        <path 
          id={`${uid}_pathC`} 
          d="M 100,160 C 100,135 100,125 100,100" 
          fill="none" 
          stroke="#C9D1DC" 
          strokeWidth="2" 
        />

        {/* Source Nodes */}
        <circle cx="40" cy="55" r="7" fill="#F2F4F8" stroke="#0FA98F" strokeWidth="2.5" />
        <circle cx="160" cy="55" r="7" fill="#F2F4F8" stroke="#E0632B" strokeWidth="2.5" />
        <circle cx="100" cy="160" r="7" fill="#F2F4F8" stroke="#0FA98F" strokeWidth="2.5" />

        {/* Core Hexagon with subtle breathing animation */}
        <polygon 
          points="100,76 121,88 121,112 100,124 79,112 79,88"
          fill={`url(#${uid}_coreFill)`} 
          stroke="#0FA98F" 
          strokeWidth="2.5"
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
            transform-origin="100 100"
          />
        </polygon>
        <polygon 
          points="100,76 121,88 121,112 100,124 79,112 79,88"
          fill="none" 
          stroke="#0FA98F" 
          strokeWidth="1" 
          opacity="0.35"
        />

        {/* Flowing Particles */}
        <circle r="4.2" fill="#0FA98F">
          <animateMotion dur="2.4s" repeatCount="indefinite" begin="0s">
            <mpath href={`#${uid}_pathA`} />
          </animateMotion>
          <animate 
            attributeName="opacity" 
            values="0;1;1;0" 
            keyTimes="0;0.1;0.85;1" 
            dur="2.4s" 
            repeatCount="indefinite" 
            begin="0s" 
          />
        </circle>

        <circle r="4.2" fill="#E0632B">
          <animateMotion dur="2.4s" repeatCount="indefinite" begin="0.8s">
            <mpath href={`#${uid}_pathB`} />
          </animateMotion>
          <animate 
            attributeName="opacity" 
            values="0;1;1;0" 
            keyTimes="0;0.1;0.85;1" 
            dur="2.4s" 
            repeatCount="indefinite" 
            begin="0.8s" 
          />
        </circle>

        <circle r="4.2" fill="#0FA98F">
          <animateMotion dur="2.4s" repeatCount="indefinite" begin="1.6s">
            <mpath href={`#${uid}_pathC`} />
          </animateMotion>
          <animate 
            attributeName="opacity" 
            values="0;1;1;0" 
            keyTimes="0;0.1;0.85;1" 
            dur="2.4s" 
            repeatCount="indefinite" 
            begin="1.6s" 
          />
        </circle>
      </svg>
    </div>
  );

  const wordmarkElement = (
    <div className={`tracking-tight select-none whitespace-nowrap ${config.fontSize}`}>
      <span className="text-[#12161F]">DATA</span>
      <span className="text-[#0FA98F]">CORE</span>
    </div>
  );

  const taglineElement = (
    <div 
      className={`uppercase tracking-[0.14em] text-[#6A7280] font-medium whitespace-nowrap select-none ${config.taglineSize} ${config.taglineOffset}`}
    >
      DATA PIPELINE PLATFORM
    </div>
  );

  if (iconOnly) {
    return iconElement;
  }

  // Layout 1: Stage (Matching exact HTML script layout with lockup row and tagline below)
  if (layout === 'stage') {
    return (
      <div 
        className={`inline-flex flex-col items-center ${config.stageGap} ${className}`}
        style={{ fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
      >
        <div className={`flex items-center ${config.gap}`}>
          {iconElement}
          {showWordmark && wordmarkElement}
        </div>
        {showTagline && taglineElement}
      </div>
    );
  }

  // Layout 2: Vertical
  if (layout === 'vertical') {
    return (
      <div 
        className={`inline-flex flex-col items-center text-center ${config.gap} ${className}`}
        style={{ fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
      >
        {iconElement}
        {showWordmark && (
          <div className="flex flex-col items-center">
            {wordmarkElement}
            {showTagline && taglineElement}
          </div>
        )}
      </div>
    );
  }

  // Layout 3: Horizontal (Default)
  return (
    <div 
      className={`inline-flex items-center ${config.gap} ${className}`}
      style={{ fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      {iconElement}
      {showWordmark && (
        <div className="flex flex-col justify-center">
          {wordmarkElement}
          {showTagline && taglineElement}
        </div>
      )}
    </div>
  );
};
