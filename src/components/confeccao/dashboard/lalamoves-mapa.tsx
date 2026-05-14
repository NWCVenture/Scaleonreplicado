"use client";

// Mapa de Lalamoves ativos (RITM-20).
//
// Leaflet + OpenStreetMap. Carregado dinamicamente (ssr: false) pra
// evitar acesso a `window` durante render no servidor.

import { useEffect } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Fix do ícone padrão do Leaflet (não funciona out-of-the-box com
// bundlers que não copiam os assets). Carrega URLs externas.
const ICONES_LEAFLET = {
  iconUrl:
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:
    "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
};

interface LalamoveMapItem {
  id: string;
  status: string;
  ordemProducaoNumero: string;
  conteudoDescricao: string | null;
  lat: number;
  lng: number;
  fonte: "driver" | "origem" | "destino";
}

interface LalamovesMapaProps {
  items: LalamoveMapItem[];
}

const STATUS_LABEL: Record<string, string> = {
  procurando_motorista: "Procurando motorista",
  motorista_designado: "Motorista designado",
  a_caminho_coleta: "A caminho da coleta",
  coletado: "Coletado",
};

export default function LalamovesMapa({ items }: LalamovesMapaProps) {
  // Configura ícones na primeira render no cliente
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions(ICONES_LEAFLET);
  }, []);

  if (items.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-md border bg-card text-sm text-muted-foreground">
        Nenhum Lalamove ativo com localização no momento.
      </div>
    );
  }

  // Centra no centroide dos pontos
  const centerLat = items.reduce((s, i) => s + i.lat, 0) / items.length;
  const centerLng = items.reduce((s, i) => s + i.lng, 0) / items.length;

  return (
    <div className="h-80 w-full overflow-hidden rounded-md border">
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={11}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {items.map((i) => (
          <Marker key={i.id} position={[i.lat, i.lng]}>
            <Popup>
              <div className="space-y-1 text-xs">
                <div className="font-medium">{i.ordemProducaoNumero}</div>
                <div className="text-muted-foreground">
                  {STATUS_LABEL[i.status] ?? i.status}
                </div>
                {i.conteudoDescricao && (
                  <div className="text-muted-foreground">
                    {i.conteudoDescricao}
                  </div>
                )}
                <div className="text-muted-foreground italic">
                  fonte: {i.fonte}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
