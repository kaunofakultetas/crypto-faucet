import React from 'react';

const LineComponent = ({ fromHash, toHash, isPanelOpen }) => {
  // Use React ref to get actual DOM positions
  const [positions, setPositions] = React.useState(null);
  
  React.useEffect(() => {
    const updatePositions = () => {
      const fromElement = document.querySelector(`[data-block-hash="${fromHash}"]`);
      const toElement = document.querySelector(`[data-block-hash="${toHash}"]`);
      
      if (fromElement && toElement) {
        const fromRect = fromElement.getBoundingClientRect();
        const toRect = toElement.getBoundingClientRect();
        const containerRect = document.querySelector('.main-content-area').getBoundingClientRect();
        
        setPositions({
          startX: fromRect.left + fromRect.width / 2 - containerRect.left,
          startY: fromRect.bottom - containerRect.top,
          endX: toRect.left + toRect.width / 2 - containerRect.left,
          endY: toRect.top - containerRect.top
        });
      }
    };
    
    // Immediate update using requestAnimationFrame for smooth transition start
    const animationFrame = requestAnimationFrame(updatePositions);
    
    // Multiple rapid updates during transition for smooth animation
    const timeouts = [
      setTimeout(updatePositions, 16),   // ~1 frame at 60fps
      setTimeout(updatePositions, 32),   // ~2 frames 
      setTimeout(updatePositions, 64),   // ~4 frames
      setTimeout(updatePositions, 100),  // Mid transition
      setTimeout(updatePositions, 150),  // Mid transition
      setTimeout(updatePositions, 200),  // Near end
      setTimeout(updatePositions, 300),  // Transition end
      setTimeout(updatePositions, 350)   // Final update
    ];
    
    window.addEventListener('resize', updatePositions);
    
    return () => {
      cancelAnimationFrame(animationFrame);
      timeouts.forEach(timeout => clearTimeout(timeout));
      window.removeEventListener('resize', updatePositions);
    };
  }, [fromHash, toHash, isPanelOpen]);
  
  if (!positions) return null;
  
  const { startX, startY, endX, endY } = positions;
  
  // Calculate control point for smooth curve
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const controlX = startX + deltaX / 2;
  const controlY = startY + deltaY / 3;
  
  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1
      }}
    >
      <path
        d={`M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`}
        stroke="#4a90e2"
        strokeWidth="2"
        fill="none"
      />
    </svg>
  );
};

export default LineComponent;
