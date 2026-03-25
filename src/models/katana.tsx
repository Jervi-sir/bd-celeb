import { useLoader } from "@react-three/fiber";
import type { ThreeElements } from "@react-three/fiber";
import { useMemo } from "react";
import type { Group } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type KatanaProps = ThreeElements["group"];

export function Katana({ children, ...groupProps }: KatanaProps) {
  const gltf = useLoader(GLTFLoader, "/red_cyber_katana.glb");
  const katanaScene = useMemo<Group | null>(() => gltf.scene?.clone(true) ?? null, [gltf.scene]);

  if (!katanaScene) {
    return null;
  }

  return (
    <group {...groupProps}>
      <primitive object={katanaScene} />
      {children}
    </group>
  );
}
