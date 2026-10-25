import { useEffect, useState } from 'react';
export function useViewport() {
  const [v, setV] = useState({ w: 390, h: 844 });
  useEffect(() => {
    const f = () => setV({ w: window.innerWidth, h: window.innerHeight });
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return v;
}
