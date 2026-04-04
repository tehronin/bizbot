-- CreateEnum
CREATE TYPE "public"."BuilderProjectLifecycle" AS ENUM ('DRAFT', 'PLANNED', 'ACTIVE', 'BLOCKED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "public"."BuilderMilestoneStatus" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "public"."BuilderTaskSpecStatus" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "public"."BuilderTaskSpecValidator" AS ENUM ('BUILD', 'TEST', 'LINT', 'TYPECHECK', 'NONE', 'MANUAL_REVIEW');

-- AlterTable
ALTER TABLE "public"."BuilderProject"
ADD COLUMN "lifecycle" "public"."BuilderProjectLifecycle" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "public"."BuilderTask"
ADD COLUMN "taskSpecId" TEXT;

-- CreateTable
CREATE TABLE "public"."BuilderProjectBrief" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderProjectBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuilderMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "public"."BuilderMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuilderTaskSpec" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "public"."BuilderTaskSpecStatus" NOT NULL DEFAULT 'PENDING',
    "sortOrder" INTEGER NOT NULL,
    "completionCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validators" "public"."BuilderTaskSpecValidator"[] DEFAULT ARRAY[]::"public"."BuilderTaskSpecValidator"[],
    "architecturalDecisionKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderTaskSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BuilderTaskSpecDependency" (
    "taskSpecId" TEXT NOT NULL,
    "dependsOnTaskSpecId" TEXT NOT NULL,

    CONSTRAINT "BuilderTaskSpecDependency_pkey" PRIMARY KEY ("taskSpecId","dependsOnTaskSpecId")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuilderProjectBrief_projectId_key" ON "public"."BuilderProjectBrief"("projectId");

-- CreateIndex
CREATE INDEX "BuilderMilestone_projectId_status_sortOrder_idx" ON "public"."BuilderMilestone"("projectId", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderMilestone_projectId_sortOrder_key" ON "public"."BuilderMilestone"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "BuilderTaskSpec_projectId_status_sortOrder_idx" ON "public"."BuilderTaskSpec"("projectId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "BuilderTaskSpec_milestoneId_status_sortOrder_idx" ON "public"."BuilderTaskSpec"("milestoneId", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderTaskSpec_milestoneId_sortOrder_key" ON "public"."BuilderTaskSpec"("milestoneId", "sortOrder");

-- CreateIndex
CREATE INDEX "BuilderTaskSpecDependency_dependsOnTaskSpecId_idx" ON "public"."BuilderTaskSpecDependency"("dependsOnTaskSpecId");

-- CreateIndex
CREATE INDEX "BuilderTask_taskSpecId_status_updatedAt_idx" ON "public"."BuilderTask"("taskSpecId", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "public"."BuilderProjectBrief" ADD CONSTRAINT "BuilderProjectBrief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."BuilderProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderMilestone" ADD CONSTRAINT "BuilderMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."BuilderProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderTaskSpec" ADD CONSTRAINT "BuilderTaskSpec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."BuilderProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderTaskSpec" ADD CONSTRAINT "BuilderTaskSpec_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "public"."BuilderMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderTaskSpecDependency" ADD CONSTRAINT "BuilderTaskSpecDependency_taskSpecId_fkey" FOREIGN KEY ("taskSpecId") REFERENCES "public"."BuilderTaskSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderTaskSpecDependency" ADD CONSTRAINT "BuilderTaskSpecDependency_dependsOnTaskSpecId_fkey" FOREIGN KEY ("dependsOnTaskSpecId") REFERENCES "public"."BuilderTaskSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BuilderTask" ADD CONSTRAINT "BuilderTask_taskSpecId_fkey" FOREIGN KEY ("taskSpecId") REFERENCES "public"."BuilderTaskSpec"("id") ON DELETE SET NULL ON UPDATE CASCADE;