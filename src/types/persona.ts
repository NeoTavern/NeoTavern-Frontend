export interface PersonaConnection {
  id: string; // character avatar
}

export interface PersonaDescription {
  description: string;
  lorebooks: string[];
  connections: PersonaConnection[];
}

export interface Persona extends PersonaDescription {
  avatarId: string;
  name: string;
}
