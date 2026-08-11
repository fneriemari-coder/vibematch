-- CreateEnum
CREATE TYPE "NewsCategory" AS ENUM ('ENGENHARIA', 'MARKETING', 'FINANCAS', 'PUBLICIDADE', 'TECNOLOGIA', 'GESTAO', 'EMPREENDEDORISMO');

-- CreateEnum
CREATE TYPE "NewsMediaKind" AS ENUM ('ARTICLE', 'VIDEO', 'PAPER');

-- CreateTable
CREATE TABLE "news_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feed_url" TEXT NOT NULL,
    "site_url" TEXT NOT NULL,
    "category" "NewsCategory" NOT NULL,
    "media_kind" "NewsMediaKind" NOT NULL DEFAULT 'ARTICLE',
    "language" TEXT NOT NULL DEFAULT 'pt',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_fetched_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_items" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "image_url" TEXT,
    "video_url" TEXT,
    "author" TEXT,
    "category" "NewsCategory" NOT NULL,
    "media_kind" "NewsMediaKind" NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "saves_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_news_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "news_item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_news_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_sources_feed_url_key" ON "news_sources"("feed_url");

-- CreateIndex
CREATE INDEX "news_sources_active_category_idx" ON "news_sources"("active", "category");

-- CreateIndex
CREATE INDEX "news_items_published_at_idx" ON "news_items"("published_at");

-- CreateIndex
CREATE INDEX "news_items_category_published_at_idx" ON "news_items"("category", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_items_source_id_external_id_key" ON "news_items"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "saved_news_items_user_id_created_at_idx" ON "saved_news_items"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "saved_news_items_user_id_news_item_id_key" ON "saved_news_items"("user_id", "news_item_id");

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "news_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_news_items" ADD CONSTRAINT "saved_news_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_news_items" ADD CONSTRAINT "saved_news_items_news_item_id_fkey" FOREIGN KEY ("news_item_id") REFERENCES "news_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
