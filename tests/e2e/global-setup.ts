import { addMember } from '@/lib/members';
import { closeDb, db } from './helpers';
import { writeQrVideo } from './fake-camera';

// Runs after the app and its database are up. Makes the one person whose QR
// the fake camera shows, and the video file itself.
export default async function globalSetup() {
  const member = await addMember(db(), { firstName: 'Camera', lastName: 'Person' }, null);
  writeQrVideo('.e2e/camera.y4m', member.scanCode);
  await closeDb();
}
