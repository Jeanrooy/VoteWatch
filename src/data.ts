export type Province = { id: string; name: string; center: [number, number] };
export const provinces: Province[] = [
  {
    id: "EC",
    name: "Eastern Cape",
    center: [26.465209999000052, -32.10783000099994],
  },
  {
    id: "FS",
    name: "Free State",
    center: [27.065875000000062, -28.68143500249991],
  },
  {
    id: "GT",
    name: "Gauteng",
    center: [28.12738000150003, -26.01666100299994],
  },
  {
    id: "KZ",
    name: "KwaZulu-Natal",
    center: [30.909242500500042, -28.943529999999924],
  },
  {
    id: "MP",
    name: "Mpumalanga",
    center: [30.13852750050006, -25.743664999999936],
  },
  {
    id: "NC",
    name: "Northern Cape",
    center: [21.000609999500032, -28.855427499999934],
  },
  {
    id: "LI",
    name: "Limpopo",
    center: [29.14568733300007, -23.77391000099997],
  },
  {
    id: "NW",
    name: "North West",
    center: [25.463679998500083, -26.37491949949996],
  },
  {
    id: "WC",
    name: "Western Cape",
    center: [20.962780002000045, -32.639299997999956],
  },
];
export const number = (n: number) => new Intl.NumberFormat("en-ZA").format(n);
