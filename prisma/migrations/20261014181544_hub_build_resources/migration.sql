-- CreateEnum
CREATE TYPE "ResourceSection" AS ENUM ('HERO', 'BEFORE', 'BUILD', 'AFTER');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('PDF', 'VIDEO', 'CHECKLIST', 'GUIDE', 'LINK', 'APP_3D');

-- CreateTable
CREATE TABLE "BuildResource" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "variantId" TEXT,
    "variantTitle" TEXT,
    "section" "ResourceSection" NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "meta" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitSpec" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "variantId" TEXT,
    "variantTitle" TEXT,
    "specLabel" TEXT,
    "buildTime" TEXT,
    "deckSize" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitSpec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuildResource_shop_productId_idx" ON "BuildResource"("shop", "productId");

-- CreateIndex
CREATE INDEX "KitSpec_shop_productId_idx" ON "KitSpec"("shop", "productId");
