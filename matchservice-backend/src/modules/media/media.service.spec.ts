import { MediaService } from './media.service';

describe('MediaService', () => {
  it('namespaces the S3 key under purpose/userId so a client can never write into another user\'s prefix', async () => {
    const storage = {
      getPresignedUploadUrl: jest.fn().mockResolvedValue({
        uploadUrl: 'https://s3.example/signed',
        publicUrl: 'https://bucket.s3.region.amazonaws.com/uploads/discovery_post/user-1/abc.jpg',
        expiresInSeconds: 300,
      }),
    };
    const service = new MediaService(storage as any);

    const result = await service.createPresignedUpload('user-1', {
      contentType: 'image/jpeg',
      purpose: 'discovery_post',
    });

    const [key, contentType] = storage.getPresignedUploadUrl.mock.calls[0];
    expect(key).toMatch(/^uploads\/discovery_post\/user-1\/[\w-]+\.jpg$/);
    expect(contentType).toBe('image/jpeg');
    expect(result.uploadUrl).toBe('https://s3.example/signed');
    expect(result.method).toBe('PUT');
    expect(result.headers['Content-Type']).toBe('image/jpeg');
  });

  it('maps each allowed content type to the right file extension', async () => {
    const storage = {
      getPresignedUploadUrl: jest.fn().mockResolvedValue({ uploadUrl: 'x', publicUrl: 'y', expiresInSeconds: 300 }),
    };
    const service = new MediaService(storage as any);

    await service.createPresignedUpload('user-1', { contentType: 'video/mp4', purpose: 'chat_attachment' });

    const [key] = storage.getPresignedUploadUrl.mock.calls[0];
    expect(key.endsWith('.mp4')).toBe(true);
  });
});
