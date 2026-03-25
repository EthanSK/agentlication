import React from "react";
import { MODELS } from "@agentlication/contracts";

interface Props {
  selected: string;
  onChange: (modelId: string) => void;
}

export default function ModelPicker({ selected, onChange }: Props) {
  return (
    <select
      className="model-picker"
      value={selected}
      onChange={(e) => onChange(e.target.value)}
    >
      {MODELS.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  );
}
