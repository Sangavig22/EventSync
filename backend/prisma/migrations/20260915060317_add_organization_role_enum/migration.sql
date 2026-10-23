/*
  Warnings:

  - Changed the type of `role` on the `OrganizationMember` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'ANALYST');

-- AlterTable
ALTER TABLE "OrganizationMember" DROP COLUMN "role",
ADD COLUMN     "role" "OrganizationRole" NOT NULL;
