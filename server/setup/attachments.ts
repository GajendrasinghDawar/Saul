import {
  getSecret,
  markSettingActive,
  validateSettingValue,
} from '../secretsManager.ts'
import { AttachmentStore } from '../services/attachments.ts'

export function setupAttachments() {
  const values = {
    S3_ENDPOINT: getSecret('S3_ENDPOINT'),
    S3_REGION: getSecret('S3_REGION', 'us-east-1'),
    S3_BUCKET: getSecret('S3_BUCKET'),
    S3_ACCESS_KEY_ID: getSecret('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: getSecret('S3_SECRET_ACCESS_KEY'),
  }
  for (const name of Object.keys(values) as (keyof typeof values)[]) {
    if (values[name] && !validateSettingValue(name, values[name]))
      throw new Error(`Invalid attachment storage setting: ${name}`)
    markSettingActive(name, values[name])
  }
  if (!Object.values(values).every(Boolean)) return new AttachmentStore()
  return new AttachmentStore({
    endpoint: values.S3_ENDPOINT,
    region: values.S3_REGION,
    bucket: values.S3_BUCKET,
    accessKeyId: values.S3_ACCESS_KEY_ID,
    secretAccessKey: values.S3_SECRET_ACCESS_KEY,
  })
}
