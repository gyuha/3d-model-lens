import { registerGLTFExtension } from '@babylonjs/loaders/glTF/2.0/glTFLoaderExtensionRegistry.js';

/**
 * glTF 2.0 확장을 **선별해서** 등록한다.
 *
 * Babylon 의 `registerBuiltInGLTFExtensions()` 는 42개를 전부 등록하는데, 그중 일부가
 * 외부 CDN에서 디코더나 에셋을 가져온다. 웹뷰 CSP 가 그 요청을 차단하므로 해당 확장을 쓴
 * 모델은 "원인을 알 수 없이" 실패한다. 등록하지 않으면 Babylon 이 "지원하지 않는 확장"으로
 * 명확히 보고하므로, 조용한 실패보다 낫다. (ADR 260822-115455b)
 *
 * 제외한 8개:
 * - `EXT_meshopt_compression` — unpkg.com 에서 fflate 를 가져온다
 * - `KHR_draco_mesh_compression` — 외부 Draco 디코더를 가져온다
 * - `KHR_gaussian_splatting` — Gaussian Splat — 지원 범위 밖 (ADR 260822-115455)
 * - `KHR_interactivity` — 플로우 그래프 실행 엔진 — 뷰어는 상호작용 그래프를 실행하지 않는다
 * - `EXT_lights_area` — assets.babylonjs.com 에서 areaLightsLTC.bin 을 가져온다
 * - `KHR_texture_basisu` — cdn.babylonjs.com 에서 babylon.ktx2Decoder.js 를 가져온다
 * - `MSFT_audio_emitter` — 오디오 — 뷰어에 소리가 없다
 * - `KHR_materials_fuzz` — OpenPBRMaterial 의 노이즈 텍스처를 assets.babylonjs.com 에서 가져온다 — 실제로 도달 가능한 유일한 CDN 경로였다
 *
 * 이 파일은 `scripts/gen-gltf-extensions.mjs` 로 생성한다 — Babylon 을 올릴 때 재생성할 것.
 */
export function registerModelLensGLTFExtensions(): void {
  registerGLTFExtension('EXT_lights_image_based', true, async (loader) => {
    const { EXT_lights_image_based } = await import('@babylonjs/loaders/glTF/2.0/Extensions/EXT_lights_image_based.js');
    return new EXT_lights_image_based(loader);
  });
  registerGLTFExtension('EXT_mesh_gpu_instancing', true, async (loader) => {
    const { EXT_mesh_gpu_instancing } = await import('@babylonjs/loaders/glTF/2.0/Extensions/EXT_mesh_gpu_instancing.js');
    return new EXT_mesh_gpu_instancing(loader);
  });
  registerGLTFExtension('EXT_texture_avif', true, async (loader) => {
    const { EXT_texture_avif } = await import('@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_avif.js');
    return new EXT_texture_avif(loader);
  });
  registerGLTFExtension('EXT_texture_webp', true, async (loader) => {
    const { EXT_texture_webp } = await import('@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.js');
    return new EXT_texture_webp(loader);
  });
  registerGLTFExtension('ExtrasAsMetadata', false, async (loader) => {
    const { ExtrasAsMetadata } = await import('@babylonjs/loaders/glTF/2.0/Extensions/ExtrasAsMetadata.js');
    return new ExtrasAsMetadata(loader);
  });
  registerGLTFExtension('KHR_animation_pointer', true, async (loader) => {
    const { KHR_animation_pointer } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_animation_pointer.js');
    return new KHR_animation_pointer(loader);
  });
  registerGLTFExtension('KHR_lights_punctual', true, async (loader) => {
    const { KHR_lights } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_lights_punctual.js');
    return new KHR_lights(loader);
  });
  registerGLTFExtension('EXT_lights_ies', true, async (loader) => {
    const { EXT_lights_ies } = await import('@babylonjs/loaders/glTF/2.0/Extensions/EXT_lights_ies.js');
    return new EXT_lights_ies(loader);
  });
  registerGLTFExtension('KHR_materials_anisotropy', true, async (loader) => {
    const { KHR_materials_anisotropy } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_anisotropy.js');
    return new KHR_materials_anisotropy(loader);
  });
  registerGLTFExtension('KHR_materials_clearcoat', true, async (loader) => {
    const { KHR_materials_clearcoat } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_clearcoat.js');
    return new KHR_materials_clearcoat(loader);
  });
  registerGLTFExtension('KHR_materials_diffuse_roughness', true, async (loader) => {
    const { KHR_materials_diffuse_roughness } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_diffuse_roughness.js');
    return new KHR_materials_diffuse_roughness(loader);
  });
  registerGLTFExtension('KHR_materials_diffuse_transmission', true, async (loader) => {
    const { KHR_materials_diffuse_transmission } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_diffuse_transmission.js');
    return new KHR_materials_diffuse_transmission(loader);
  });
  registerGLTFExtension('KHR_materials_dispersion', true, async (loader) => {
    const { KHR_materials_dispersion } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_dispersion.js');
    return new KHR_materials_dispersion(loader);
  });
  registerGLTFExtension('KHR_materials_emissive_strength', true, async (loader) => {
    const { KHR_materials_emissive_strength } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength.js');
    return new KHR_materials_emissive_strength(loader);
  });
  registerGLTFExtension('KHR_materials_ior', true, async (loader) => {
    const { KHR_materials_ior } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_ior.js');
    return new KHR_materials_ior(loader);
  });
  registerGLTFExtension('KHR_materials_iridescence', true, async (loader) => {
    const { KHR_materials_iridescence } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_iridescence.js');
    return new KHR_materials_iridescence(loader);
  });
  registerGLTFExtension('KHR_materials_pbrSpecularGlossiness', true, async (loader) => {
    const { KHR_materials_pbrSpecularGlossiness } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_pbrSpecularGlossiness.js');
    return new KHR_materials_pbrSpecularGlossiness(loader);
  });
  registerGLTFExtension('KHR_materials_sheen', true, async (loader) => {
    const { KHR_materials_sheen } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_sheen.js');
    return new KHR_materials_sheen(loader);
  });
  registerGLTFExtension('KHR_materials_specular', true, async (loader) => {
    const { KHR_materials_specular } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular.js');
    return new KHR_materials_specular(loader);
  });
  registerGLTFExtension('KHR_materials_transmission', true, async (loader) => {
    const { KHR_materials_transmission } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_transmission.js');
    return new KHR_materials_transmission(loader);
  });
  registerGLTFExtension('KHR_materials_unlit', true, async (loader) => {
    const { KHR_materials_unlit } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit.js');
    return new KHR_materials_unlit(loader);
  });
  registerGLTFExtension('KHR_materials_variants', true, async (loader) => {
    const { KHR_materials_variants } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_variants.js');
    return new KHR_materials_variants(loader);
  });
  registerGLTFExtension('KHR_materials_volume', true, async (loader) => {
    const { KHR_materials_volume } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_volume.js');
    return new KHR_materials_volume(loader);
  });
  registerGLTFExtension('KHR_mesh_quantization', true, async (loader) => {
    const { KHR_mesh_quantization } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js');
    return new KHR_mesh_quantization(loader);
  });
  registerGLTFExtension('KHR_texture_transform', true, async (loader) => {
    const { KHR_texture_transform } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform.js');
    return new KHR_texture_transform(loader);
  });
  registerGLTFExtension('KHR_xmp_json_ld', true, async (loader) => {
    const { KHR_xmp_json_ld } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_xmp_json_ld.js');
    return new KHR_xmp_json_ld(loader);
  });
  registerGLTFExtension('MSFT_lod', true, async (loader) => {
    const { MSFT_lod } = await import('@babylonjs/loaders/glTF/2.0/Extensions/MSFT_lod.js');
    return new MSFT_lod(loader);
  });
  registerGLTFExtension('MSFT_minecraftMesh', true, async (loader) => {
    const { MSFT_minecraftMesh } = await import('@babylonjs/loaders/glTF/2.0/Extensions/MSFT_minecraftMesh.js');
    return new MSFT_minecraftMesh(loader);
  });
  registerGLTFExtension('MSFT_sRGBFactors', true, async (loader) => {
    const { MSFT_sRGBFactors } = await import('@babylonjs/loaders/glTF/2.0/Extensions/MSFT_sRGBFactors.js');
    return new MSFT_sRGBFactors(loader);
  });
  registerGLTFExtension('KHR_node_visibility', true, async (loader) => {
    const { KHR_node_visibility } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_node_visibility.js');
    return new KHR_node_visibility(loader);
  });
  registerGLTFExtension('KHR_node_hoverability', true, async (loader) => {
    const { KHR_node_hoverability } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_node_hoverability.js');
    return new KHR_node_hoverability(loader);
  });
  registerGLTFExtension('KHR_node_selectability', true, async (loader) => {
    const { KHR_node_selectability } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_node_selectability.js');
    return new KHR_node_selectability(loader);
  });
  registerGLTFExtension('KHR_materials_coat', true, async (loader) => {
    const { KHR_materials_coat } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_coat.js');
    return new KHR_materials_coat(loader);
  });
  registerGLTFExtension('KHR_materials_volume_scatter', true, async (loader) => {
    const { KHR_materials_volume_scatter } = await import('@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_volume_scatter.js');
    return new KHR_materials_volume_scatter(loader);
  });
}
