-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "isRecoveryCodeAckPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserTotp" ADD COLUMN     "recoveryCodesAcknowledgedAt" TIMESTAMP(3);
