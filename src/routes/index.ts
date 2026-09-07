import express, { Application } from "express";
import authRoutes from "./auth.routes";
import healthRoutes from "./health.routes";
import productRoutes from "./product.routes";
import orderRoutes from "./order.routes";
import uploadRoutes from "./upload.routes";
import userRoutes from "./user.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/health", healthRoutes);
  router.use("/auth", authRoutes);
  router.use("/products", productRoutes);
  router.use("/orders", orderRoutes);
  router.use("/uploads", uploadRoutes);
  router.use("/users", userRoutes);
}

export default routerApi;
