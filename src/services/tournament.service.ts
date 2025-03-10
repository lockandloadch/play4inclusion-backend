import {PrismaClient} from "@prisma/client";
import express from "express";

const SHA2 = require("sha2");

const prisma = new PrismaClient();
const router = express.Router();

export async function getRankings() {
    const scores = await findAllScores() as any[];
    scores.sort(compareRanks);
    return applyRanks(scores);
}

export function compareRanks(rank1, rank2) {
    const numScore1 = parseInt(rank1.intern);
    const numScore2 = parseInt(rank2.intern);

    if(numScore1 > numScore2) { return -1; }
    else if (numScore1 < numScore2) { return 1; }
    else { return 0; }
}

export function getImmediateRankings(userId, rankings) {
    for(const indexString in rankings) {
        let index = parseInt(indexString);
        const ranking = rankings[index];
        if(ranking.id === userId) {
            return extractImmediateRankingsByIndex(index, rankings);
        }
    }
    return [];
}

export function extractImmediateRankingsByIndex(index, rankings) {
    if(isRankingSmallerOrEqualThan3(rankings)) {
        return rankings;
    }
    else if(isUserFirstPlace(index)) {
        return rankings.slice(0, 3);
    }
    else if(isUserLastPlace(index, rankings)) {
        return rankings.slice(-3);
    }
    else {
        return rankings.slice(index-1, index+2);
    }
}

export function isRankingSmallerOrEqualThan3(rankings) {
    return rankings.length <= 3;
}

export function isUserLastPlace(index, rankings) {
    return index === rankings.length - 1;
}

export function isUserFirstPlace(index) {
    return index === 0;

}

export async function findAllScores() {
    return await prisma.$queryRaw`
    select d.id, d.nick, a.intern from t_contest a
    left join t_teilnehmer_part b
    on a.team_a = b.tnid
    left join \`user\` d
    on b.user_id = d.id
    where tid=${process.env.T_ID}`;
}

export async function applyRanks(scores) {
    const rankedScores = [];

    for(let index in scores) {
        const score = scores[index];
        let scoreText = "";
        if(score.intern !== null) {
            scoreText = score.intern
        }
        rankedScores.push({rank: parseInt(index)+1, id: score.id, nick: score.nick, score: parseMsToReadableTime(parseSecondsToMs(scoreText))})
    }

    return rankedScores;
}

export async function checkIfUserIsLanParticipant(user) {
    const lanParticipant =
        await prisma.$queryRaw
            `select event_id,user_id,bezahlt,anwesend from event_teilnehmer 
                where user_id=${user.id} and event_id=${process.env.EVENT_ID} and bezahlt=1 and anwesend>\'0000-00-00 00:00:00\'`;

    return !!lanParticipant;
}

export async function getUser(email) {
    return await prisma.user.findFirst({
        where: {
            email: email
        }
    });
}

export function isScoreValid(scoreJson) {
    const hash = SHA2.SHA512(getHashString(scoreJson)).toString("hex");
    return hash === scoreJson.ver;
}

export async function submitScore(score, user) {
    let tournamentParticipant = await getTournamentParticipant(user.id);

    if(!tournamentParticipant) {
        console.info("Registering participant")
        tournamentParticipant = await registerToTournament(user);
    }

    let currentScore = await findScoreByUserId(tournamentParticipant.tnid)

    if(isScoreExisting(currentScore)) {
        if (isPersonalHighScore(currentScore, score)) {
            await updateScore(score, tournamentParticipant.tnid);
            console.info(`Updated Highscore ${score} > ${currentScore}`);
        }
    } else {
        await createScore(score, tournamentParticipant.tnid);
        console.info(`Created Highscore ${score}`);
    }
}

export function isScoreExisting(currentScore) {
    console.log("Score is existing");
    return currentScore !== undefined && currentScore !== null;
}

export function isPersonalHighScore(currentScore, newScore) {
    console.log("Checking highscore")
    console.log(currentScore);
    console.log(newScore);
    return parseInt(currentScore) < parseInt(newScore);
}

export async function getTournamentParticipant(userId) {
    return await prisma.t_teilnehmer.findFirst({
        where: {
            tnleader: userId,
            tid: parseInt(process.env.T_ID)
        }
    });
}

export async function findScoreByUserId(tnid) {
    const contest = await prisma.t_contest.findFirst({
        where: {
            tid: parseInt(process.env.T_ID),
            team_a: tnid
        },
        select: {
            intern: true
        }
    });

    return contest ? parseSecondsToMs(contest["intern"]) : undefined;
}

export function parseMsToSeconds(score) {
    //score = string of milliseconds
    let millisecondsTotal = parseInt(score);

    //turning to strings to keep leading zeros, adding 0.1 to keep following zeros and slicing out last digit in string
    let ms = millisecondsTotal % 1000;
    let msString = (((ms + .1) / 1000) + "").slice(2, 4);
    let seconds = Math.floor(millisecondsTotal / 1000);

    return seconds + "." + msString;
}

export function parseSecondsToMs(timeString) {
    let timeArray = timeString.split(".");
    let seconds = parseInt(timeArray[0]);
    let ms = parseInt(timeArray[1]);

    return seconds * 1000 + ms;
}

export function parseMsToReadableTime(score) {
    //score = string of milliseconds
    let millisecondsTotal = parseInt(score);

    //turning to strings to keep leading zeros, adding 0.1 to keep following zeros and slicing out last digit in string
    let ms = millisecondsTotal % 1000;
    let msString = (((ms + .1) / 100) + "").slice(2, 4);
    let seconds = Math.floor(millisecondsTotal / 1000) % 60;
    let secondsString = (((seconds + .1) / 100) + "").slice(2, 4);
    let minutes = Math.floor(millisecondsTotal / 1000 / 60);

    return minutes + ":" + secondsString + "." + msString;
}

export async function createScore(score, tnid) {
    await prisma.$queryRaw
        `insert into t_contest(
                      tid, 
                      tcrunde, 
                      team_a, 
                      team_b, 
                      wins_a, 
                      wins_b, 
                      won, 
                      dateline, 
                      user_id,
                      row, 
                      comments, 
                      starttime, 
                      ignoretime, 
                      ready_a, 
                      ready_b, 
                      defaultwin, 
                      intern) 
              values (
                      ${parseInt(process.env.T_ID)},
                      0,
                      ${tnid},
                      '-2',
                      0,
                      0,
                      1,
                      '0000-00-00 00:00:00',
                      0,
                      0,
                      0,
                      '0000-00-00 00:00:00',
                      0,
                      '0000-00-00 00:00:00',
                      '0000-00-00 00:00:00',
                      0,
                       ${parseMsToSeconds(score)}
                      )`;
}

export async function updateScore(score, tnid) {

    //Since we dont deal with unique entries, we need to find first and guarantee uniqueness by business logic
    //ONLY select intern score, if prisma tries to parse zero dates from database it throws errors
    let contest = await prisma.t_contest.findFirst({
        where: {
            tid: parseInt(process.env.T_ID),
            team_a: tnid
        },
        select: {
            tcid: true
        }
    });

    await prisma.t_contest.update({
        where: {
            tcid: contest.tcid
        },
        data: {
            intern: parseMsToSeconds(score)
        },
        select: {
            intern: true
        }
    })
}

export async function registerToTournament(user) {
    const highestIndex = await prisma.t_teilnehmer.findMany({
        take: 1,
        orderBy: {
            tnid: "desc"
        }
    });

    const tournamentParticipant = await prisma.t_teilnehmer.create({
        data: {
            tnid: highestIndex[0].tnid + 1,
            tid: parseInt(process.env.T_ID),
            tnanz: 1,
            tnleader: user.id
        }
    });

    await prisma.t_teilnehmer_part.create({
        data: {
            tnid: tournamentParticipant.tnid,
            user_id: user.id,
            dateline: new Date()
        }
    });

    return tournamentParticipant;
}

export async function isTournamentLive() {
    const tournament = await prisma.t_turnier.findUnique({
        where: {
            tid: parseInt(process.env.T_ID),
        },
        select: {
            tactive: true,
            tclosed: true,
            topen: true
        }
    });

    return tournament.tactive === 1 && tournament.tclosed === 0 && tournament.topen === 1;
}

export function getHashString(scoreJson) {
    const scoreHash = parseInt(scoreJson.score) * 2896;
    const mailHash = scoreJson.email.split("@")[0] + "|" + scoreJson.score * 2;

    return scoreHash + mailHash;
}

export default router;
