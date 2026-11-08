import type { ThreeElements } from "@react-three/fiber";

type Tone = "select" | "affected" | "found";

const COLOR: Record<Tone, string> = { select: "#f39200", affected: "#c93434", found: "#2f5be9" };

/** Ring on the floor around a selected / affected object (static: no frame loop needed). */
export function Highlight({ x, z, radius = 4, tone = "select", ...rest }: { x: number; z: number; radius?: number; tone?: Tone } & ThreeElements["group"]) {
  return (
    <group position={[x, 0.42, z]} {...rest}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[radius, radius + 0.6, 48]} />
        <meshBasicMaterial color={COLOR[tone]} transparent opacity={0.85} />
      </mesh>
      {tone === "found" && (
        <mesh position={[0, 9, 0]} rotation-x={Math.PI}>
          <coneGeometry args={[1.1, 2.6, 16]} />
          <meshStandardMaterial color={COLOR.found} emissive={COLOR.found} emissiveIntensity={0.3} />
        </mesh>
      )}
    </group>
  );
}
