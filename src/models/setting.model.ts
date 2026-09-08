import mongoose, { Model, Schema } from "mongoose";

/**
 * Ajustes que el admin edita desde el panel sin tocar código: la portada del
 * home y las cuentas para transferencias. Un documento por clave; el valor es
 * libre y lo valida `setting.service` según la clave.
 */
export interface ISetting {
  key: string;
  value: Record<string, unknown>;
  updatedAt?: Date;
}

const settingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

export const Setting: Model<ISetting> =
  (mongoose.models.Setting as Model<ISetting>) ||
  mongoose.model<ISetting>("Setting", settingSchema);
