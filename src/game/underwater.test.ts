import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { UnderwaterTint } from './underwater';

describe('UnderwaterTint', () => {
  it('voile bleu tête sous l’eau, réglages d’origine restaurés à la sortie', () => {
    const scene = new THREE.Scene();
    const sky = new THREE.Color(0x7ec8ff);
    scene.background = sky;
    scene.fog = new THREE.Fog(0x7ec8ff, 32, 90);
    const fog = scene.fog as THREE.Fog;
    const tint = new UnderwaterTint(scene);

    tint.update(false);
    expect(tint.isActive).toBe(false);
    expect(fog.far).toBe(90);

    tint.update(true);
    expect(tint.isActive).toBe(true);
    expect(fog.far).toBeLessThan(40);
    expect(fog.color.getHex()).not.toBe(0x7ec8ff);
    expect(scene.background).not.toBe(sky);
    tint.update(true); // réappliqué sans perdre les valeurs mémorisées

    tint.update(false);
    expect(tint.isActive).toBe(false);
    expect(fog.near).toBe(32);
    expect(fog.far).toBe(90);
    expect(fog.color.getHex()).toBe(0x7ec8ff);
    expect(scene.background).toBe(sky);
  });

  it('sans brouillard : ne fait rien', () => {
    const scene = new THREE.Scene();
    const tint = new UnderwaterTint(scene);
    tint.update(true);
    expect(tint.isActive).toBe(false);
    expect(scene.background).toBeNull();
  });
});
