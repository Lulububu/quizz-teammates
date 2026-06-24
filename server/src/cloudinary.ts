import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';

const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? '';
const apiKey = process.env.CLOUDINARY_API_KEY ?? '';
const apiSecret = process.env.CLOUDINARY_API_SECRET ?? '';

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

export type CloudinaryUploadKind = 'image' | 'audio' | 'video';

export function createCloudinaryUploadSignature(ownerUserId: string, kind: CloudinaryUploadKind) {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary doit être configuré côté serveur.');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `quiz-teammates/${ownerUserId}`;
  const publicId = randomUUID();
  const signature = cloudinary.utils.api_sign_request(
    {
      folder,
      public_id: publicId,
      timestamp,
    },
    apiSecret,
  );

  return {
    apiKey,
    cloudName,
    folder,
    publicId,
    resourceType: kind === 'image' ? 'image' : 'video',
    signature,
    timestamp,
  };
}
