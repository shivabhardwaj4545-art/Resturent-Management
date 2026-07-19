import { v2 as cloudinaryV2, UploadApiResponse } from 'cloudinary';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

// Configure Cloudinary
cloudinaryV2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Multer setup for memory storage (files stored in buffer)
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Only JPEG, PNG, and WebP images are allowed.', 400, 'INVALID_FILE_TYPE'));
    }
  },
});

export async function uploadImageToCloudinary(
  buffer: Buffer,
  folder: string,
  publicId?: string
): Promise<{ url: string; publicId: string }> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  const isConfigured =
    cloudName &&
    cloudName !== 'your-cloudinary-cloud-name' &&
    apiKey &&
    apiKey !== 'your-cloudinary-api-key' &&
    apiSecret &&
    apiSecret !== 'your-cloudinary-api-secret';

  if (!isConfigured) {
    logger.warn('⚠️ Cloudinary is not configured or using placeholders. Falling back to local storage.');
    
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    // Create a unique sanitized filename
    const sanitizedFolder = folder.replace(/[^a-zA-Z0-9-_]/g, '_');
    const sanitizedPublicId = publicId ? publicId.replace(/[^a-zA-Z0-9-_]/g, '_') : Date.now().toString();
    const filename = `${sanitizedFolder}_${sanitizedPublicId}.png`;
    const filePath = path.join(uploadsDir, filename);
    
    fs.writeFileSync(filePath, buffer);
    
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    const url = `${apiUrl}/uploads/${filename}`;
    
    return { url, publicId: filename };
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinaryV2.uploader.upload_stream(
      {
        folder: `qr-restaurant/${folder}`,
        public_id: publicId,
        resource_type: 'image',
        transformation: [
          { quality: 'auto:best', fetch_format: 'auto' },
          { width: 1200, crop: 'limit' },
        ],
        overwrite: true,
      },
      (error, result: UploadApiResponse | undefined) => {
        if (error) {
          reject(new AppError('Image upload failed: ' + error.message, 500, 'UPLOAD_FAILED'));
          return;
        }
        if (!result) {
          reject(new AppError('Upload returned no result', 500, 'UPLOAD_FAILED'));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );

    uploadStream.end(buffer);
  });
}

export async function deleteImageFromCloudinary(publicId: string): Promise<void> {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const isConfigured = cloudName && cloudName !== 'your-cloudinary-cloud-name' && apiKey && apiKey !== 'your-cloudinary-api-key';

    if (!isConfigured || publicId.includes('_') || publicId.endsWith('.png')) {
      const uploadsDir = path.join(__dirname, '../../uploads');
      const filePath = path.join(uploadsDir, publicId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted local file: ${publicId}`);
      }
      return;
    }
    await cloudinaryV2.uploader.destroy(publicId);
  } catch (error: any) {
    logger.warn(`Failed to delete image: ${error.message}`);
  }
}

export async function uploadMenuItemImage(
  buffer: Buffer,
  restaurantSlug: string,
  itemName: string
): Promise<string> {
  const sanitizedName = itemName.toLowerCase().replace(/\s+/g, '-');
  const { url } = await uploadImageToCloudinary(
    buffer,
    `menus/${restaurantSlug}`,
    `${sanitizedName}-${Date.now()}`
  );
  return url;
}

export async function uploadRestaurantLogo(
  buffer: Buffer,
  slug: string
): Promise<string> {
  const { url } = await uploadImageToCloudinary(buffer, 'logos', `${slug}-logo`);
  return url;
}

export async function uploadRestaurantBanner(
  buffer: Buffer,
  slug: string
): Promise<string> {
  const { url } = await uploadImageToCloudinary(buffer, 'banners', `${slug}-banner`);
  return url;
}

export async function uploadRestaurantPaymentQr(
  buffer: Buffer,
  slug: string
): Promise<string> {
  const { url } = await uploadImageToCloudinary(buffer, 'payment-qrs', `${slug}-payment-qr`);
  return url;
}
