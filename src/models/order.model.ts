import mongoose, { Model, Schema } from "mongoose";
import { ORDER_STATUSES, OrderStatus, PAYMENT_STATUSES, PaymentStatus } from "../config/shop";

export interface IOrderItem {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string;
  image: string;
  unitPrice: number;
  qty: number;
  subtotal: number;
}

export interface IOrder {
  /** Código legible para el cliente y el admin: PF-000123. */
  number: string;
  /** Token público del pedido; también es el clientTransactionId de PayPhone. */
  clientTransactionId: string;
  /** Dominio del front donde se hizo la compra: los correos enlazan ahí. */
  siteUrl: string;
  userId: string | null;
  customer: { name: string; email: string; phone: string; documentId: string };
  shipping: {
    method: string;
    label: string;
    address: string;
    city: string;
    reference: string;
    notes: string;
  };
  items: IOrderItem[];
  subtotal: number;
  shippingCost: number;
  taxRate: number;
  tax: number;
  total: number;
  status: OrderStatus;
  payment: {
    method: "payphone";
    status: PaymentStatus;
    payphoneId: number | null;
    authorizationCode: string;
    cardBrand: string;
    paidAt: Date | null;
    message: string;
  };
  stockIssue: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const itemSchema = new Schema<IOrderItem>(
  {
    productId: { type: String, required: true },
    variantId: { type: String, default: null },
    name: { type: String, required: true },
    variantLabel: { type: String, default: "" },
    image: { type: String, default: "" },
    unitPrice: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    number: { type: String, required: true, unique: true, index: true },
    clientTransactionId: { type: String, required: true, unique: true, index: true },
    siteUrl: { type: String, default: "" },
    userId: { type: String, default: null, index: true },
    customer: {
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true, index: true },
      phone: { type: String, default: "" },
      documentId: { type: String, default: "" },
    },
    shipping: {
      method: { type: String, required: true },
      label: { type: String, default: "" },
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      reference: { type: String, default: "" },
      notes: { type: String, default: "" },
    },
    items: { type: [itemSchema], required: true },
    subtotal: { type: Number, required: true },
    shippingCost: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: "pending_payment", index: true },
    payment: {
      method: { type: String, default: "payphone" },
      status: { type: String, enum: PAYMENT_STATUSES, default: "pending" },
      payphoneId: { type: Number, default: null },
      authorizationCode: { type: String, default: "" },
      cardBrand: { type: String, default: "" },
      paidAt: { type: Date, default: null },
      message: { type: String, default: "" },
    },
    stockIssue: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Order: Model<IOrder> =
  (mongoose.models.Order as Model<IOrder>) || mongoose.model<IOrder>("Order", orderSchema);

// Contador para numerar pedidos de forma consecutiva y legible.
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

export async function nextOrderNumber(): Promise<string> {
  const doc = await Counter.findByIdAndUpdate(
    "order",
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return `PF-${String(doc.seq).padStart(6, "0")}`;
}
