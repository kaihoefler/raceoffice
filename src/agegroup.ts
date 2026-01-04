export type AgeGroup = {
  id: string;
  name: string;

  gender: "male" | "female" | "mixed";
  minAge: number;
  maxAge: number;
  
  eventId: string;

};