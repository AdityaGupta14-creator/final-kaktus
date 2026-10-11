'use client';

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 3D Particle Wave
function ParticleWave() {
  const count = 3000;
  
  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);
    
    const colorA = new THREE.Color('#eab308'); // Yellow
    const colorB = new THREE.Color('#22c55e'); // Green
    const colorC = new THREE.Color('#f97316'); // Orange

    for (let i = 0; i < count; i++) {
      const phi = Math.acos(1 - (2 * i) / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      
      const radius = 6;
      
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      
      const tempColor = new THREE.Color();
      const t1 = (x + radius) / (radius * 2);
      const t2 = (y + radius) / (radius * 2);
      
      tempColor.lerpColors(colorA, colorB, t1);
      tempColor.lerp(colorC, t2);
      
      cols[i * 3] = tempColor.r;
      cols[i * 3 + 1] = tempColor.g;
      cols[i * 3 + 2] = tempColor.b;
    }
    return { positions: pos, colors: cols };
  }, []);

  const pointsRef = useRef<THREE.Points>(null);
  
  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.03;
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.05;
    }
  });

  return (
    <points ref={pointsRef} position={[-4, 0, -2]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial 
        size={0.06} 
        vertexColors 
        transparent 
        opacity={0.8} 
        sizeAttenuation={true} 
      />
    </points>
  );
}

export default function HeroCanvas() {
  return (
    <div className="thread-particles absolute inset-0 z-0 pointer-events-none opacity-60">
      <Canvas camera={{ position: [0, 0, 10], fov: 45 }}>
        <ambientLight intensity={1} />
        <ParticleWave />
      </Canvas>
    </div>
  );
}
