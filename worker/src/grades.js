export async function getGradeList(sheets) {
	return sheets.getSheetAsObjects('Grade');
}

export async function getGradeById(sheets, gradeId) {
	const grades = await sheets.getSheetAsObjects('Grade');
	return grades.find((g) => g['會員等級ID'] === gradeId) || null;
}

export async function getGradeIdByName(sheets, gradeName) {
	const grades = await sheets.getSheetAsObjects('Grade');
	const grade = grades.find((g) => g['會員等級名稱'] === gradeName);
	return grade ? grade['會員等級ID'] : null;
}
