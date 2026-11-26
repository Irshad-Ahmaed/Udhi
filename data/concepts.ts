import type { Concept } from "@/lib/types";

/**
 * The 5 GCSE science and maths concepts from the assignment specification.
 * `promptText` is kept verbatim from the "Text for the model" column.
 */
export const CONCEPTS: Concept[] = [
  {
    id: "pythagoras",
    number: 1,
    name: "Pythagoras' theorem",
    subject: "Maths",
    promptText:
      "In a right-angled triangle, the longest side is called the hypotenuse. The square of the hypotenuse is equal to the sum of the squares of the other two sides: a² + b² = c².",
  },
  {
    id: "circle-parts",
    number: 2,
    name: "Parts of a circle",
    subject: "Maths",
    promptText:
      "A circle has a centre. The radius is the distance from the centre to the edge. The diameter goes across the circle through the centre and is twice the radius. The circumference is the distance around the circle.",
  },
  {
    id: "series-circuit",
    number: 3,
    name: "Series circuit",
    subject: "Physics",
    promptText:
      "In a series circuit there is only one loop. The current is the same everywhere in the loop. The voltage of the cell is shared between the components.",
  },
  {
    id: "photosynthesis",
    number: 4,
    name: "Photosynthesis",
    subject: "Biology",
    promptText:
      "Plants take in carbon dioxide and water. They use light energy, absorbed by chlorophyll, to make glucose and oxygen.",
  },
  {
    id: "states-of-matter",
    number: 5,
    name: "States of matter",
    subject: "Chemistry",
    promptText:
      "In a solid the particles are close together and vibrate in place. In a liquid they are close but move past each other. In a gas they are far apart and move fast.",
  },
];

export function getConceptById(id: string): Concept | undefined {
  return CONCEPTS.find((c) => c.id === id);
}
