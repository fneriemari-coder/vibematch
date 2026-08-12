-- CreateEnum
CREATE TYPE "WorkspaceDocKind" AS ENUM ('CONTRATO', 'PROPOSTA', 'FINANCEIRO', 'PLANILHA', 'RELATORIO', 'OUTRO');

-- CreateEnum
CREATE TYPE "WorkspaceAnalysisStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "workspace_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "kind" "WorkspaceDocKind" NOT NULL,
    "extracted_text" TEXT NOT NULL,
    "char_count" INTEGER NOT NULL,
    "storage_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_analyses" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "WorkspaceAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggested_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_documents_user_id_created_at_idx" ON "workspace_documents"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_analyses_user_id_created_at_idx" ON "workspace_analyses"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_analyses_document_id_created_at_idx" ON "workspace_analyses"("document_id", "created_at");

-- AddForeignKey
ALTER TABLE "workspace_documents" ADD CONSTRAINT "workspace_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_analyses" ADD CONSTRAINT "workspace_analyses_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "workspace_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_analyses" ADD CONSTRAINT "workspace_analyses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

