import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { FirebaseRepository } from '../../admin-core/repository';
import { Prerequisite, Program } from './modal/program';
import { db } from '@/lib/config/firebase';
import { Results } from '../applications/modals/Results';
import { Application } from '../applications/modals/Application';
import { certificateRepository } from '../certificates/repository';

class ProgramRepository extends FirebaseRepository<Program> {
  constructor() {
    super('programs');
  }

  async addPrerequisite(programId: string, prerequisite: Prerequisite) {
    const docRef = doc(db, this.collectionName, programId);
    const program = (await getDoc(docRef)).data() as Program;
    const prerequisites = program.prerequisites || [];
    const exists = prerequisites.find(
      (it) =>
        it.courseName === prerequisite.courseName &&
        it.certificateId === prerequisite.certificateId
    );
    if (!exists) {
      prerequisites.push(prerequisite);
    }
    await setDoc(docRef, { ...program, prerequisites });
  }

  async removePrerequisite(programId: string, prerequisite: Prerequisite) {
    const docRef = doc(db, this.collectionName, programId);
    const program = (await getDoc(docRef)).data() as Program;
    const prerequisites = program.prerequisites || [];
    const exists = prerequisites.find(
      (it) =>
        it.courseName === prerequisite.courseName &&
        it.certificateId === prerequisite.certificateId
    );
    if (exists) {
      const index = prerequisites.indexOf(exists);
      prerequisites.splice(index, 1);
    }
    await setDoc(docRef, { ...program, prerequisites });
  }

  async updatePrerequisite(
    programId: string,
    oldPrerequisite: Prerequisite,
    newPrerequisite: Prerequisite
  ) {
    const docRef = doc(db, this.collectionName, programId);
    const program = (await getDoc(docRef)).data() as Program;
    const prerequisites = program.prerequisites || [];
    const exists = prerequisites.find(
      (it) =>
        it.courseName === oldPrerequisite.courseName &&
        it.certificateId === oldPrerequisite.certificateId
    );
    if (exists) {
      const index = prerequisites.indexOf(exists);
      prerequisites.splice(index, 1, newPrerequisite);
    }
    await setDoc(docRef, { ...program, prerequisites });
  }

  async getWithMinCredits(minCredits: number) {
    const q = query(
      collection(db, this.collectionName),
      where('requiredCredits', '<=', minCredits)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return [];
    return snapshot.docs.map(
      (doc) => ({ ...doc.data(), id: doc.id } as Program)
    );
  }

  async getRecommendations(application: Application) {
    if (application.results.length === 0 || !application.certificate) {
      return [];
    }
    const cert = await certificateRepository.get(application.certificate.id);
    const credits = application.results.filter(
      (it) => it.grade.level <= (cert?.passingGrade?.level || 3)
    );
    const withMatchingCredits = await this.getWithMinCredits(credits.length);
    const programs = withMatchingCredits.filter((it) => {
      const prerequisites = it.prerequisites || [];
      return prerequisites
        .filter((it) => it.mandatory)
        .every((prerequisite) =>
          credits.find(
            (it) =>
              it.course === prerequisite.courseName &&
              it.grade.level <= prerequisite.minGrade.level
          )
        );
    });

    return programs.map((it) => {
      const prerequisites = it.prerequisites || [];
      return {
        programId: it.id,
        programName: it.name,
        faculty: it.faculty,
        match: getScore(it, credits, prerequisites),
      } as Recommendation;
    });
  }
}

export const programRepository = new ProgramRepository();

function getScore(
  program: Program,
  results: Results[],
  prerequisites: Prerequisite[]
) {
  const credits = results
    .sort((a, b) => a.grade.level - b.grade.level)
    .slice(0, program.requiredCredits)
    .reduce((acc, curr) => acc + curr.grade.level, 0);

  const countPrerequisites = results.filter((it) => {
    const prerequisite = prerequisites.find(
      (prerequisite) =>
        prerequisite.courseName === it.course &&
        prerequisite.minGrade.level <= it.grade.level
    );
    return !!prerequisite;
  });

  const score = credits * 2 - countPrerequisites.length;
  const maxScore = program.requiredCredits * 2;
  const percentage = Math.round((maxScore / score) * 100);

  console.log(
    `Prerequisites: ${
      countPrerequisites.length
    }, Obtained credits ${credits}(${score}), Required Credits: ${
      program.requiredCredits
    }(${maxScore}) = ${Math.round((maxScore / score) * 100)}%`
  );

  return percentage;
}
