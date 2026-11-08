import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from "@shared/status";
import { supabase } from "./supabase";

export type PickedPhoto = { uri: string; mimeType: string; size?: number };

export async function pickPhoto(source: "library" | "camera"): Promise<PickedPhoto | { error: string } | null> {
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { error: "Camera access is off. You can turn it on in Settings." };
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8, exif: false };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  const mimeType = a.mimeType ?? "image/jpeg";
  if (!PHOTO_TYPES[mimeType]) return { error: "Photos must be JPG, PNG or WebP." };
  if (a.fileSize && a.fileSize > MAX_PHOTO_BYTES) return { error: "The photo is too large. Maximum size is 5 MB." };
  return { uri: a.uri, mimeType, size: a.fileSize };
}

// Same path convention and buckets as the website; storage RLS checks the {facility}/{user}/ prefix.
export async function uploadPhoto(bucket: "message-attachments" | "id-photos", photo: PickedPhoto, facilityId: string, userId: string) {
  const bytes = await (await fetch(photo.uri)).arrayBuffer();
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error("The photo is too large. Maximum size is 5 MB.");
  const path = `${facilityId}/${userId}/${Crypto.randomUUID()}.${PHOTO_TYPES[photo.mimeType]}`;
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: photo.mimeType });
  if (error) throw new Error("Could not upload the photo. Please try again.");
  return path;
}
